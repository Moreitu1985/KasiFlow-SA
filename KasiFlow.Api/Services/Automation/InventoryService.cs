using System.Data;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using KasiFlow.Api.Data;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Middleware;
using KasiFlow.Api.Repositories;
using KasiFlow.Core.Access;
using KasiFlow.Core.Common;
using KasiFlow.Core.Inventory;
using KasiFlow.Core.Validation;

namespace KasiFlow.Api.Services.Automation;

/// <summary>Products, stock per branch, movements, approvals, transfers and reorder suggestions.
/// Stock only changes through recorded movements, so every quantity can be traced.</summary>
public sealed partial class InventoryService(IDbConnectionFactory db, IBusinessContext business)
{
    public const int SalesWindowDays = 30;

    [GeneratedRegex("^[A-Za-z0-9._-]{1,40}$")] private static partial Regex SkuPattern();
    [GeneratedRegex("^[0-9]{6,14}$")] private static partial Regex BarcodePattern();

    private sealed class ProductRow
    {
        public Guid Id { get; set; }
        public string Sku { get; set; } = "";
        public string? Barcode { get; set; }
        public string Name { get; set; } = "";
        public string Kind { get; set; } = "";
        public long UnitPriceCents { get; set; }
        public long UnitCostCents { get; set; }
        public int MinStockQty { get; set; }
        public int? LeadTimeDays { get; set; }
        public Guid? SupplierId { get; set; }
        public string? SupplierName { get; set; }
        public bool IsActive { get; set; }
    }

    private sealed class LevelRow
    {
        public Guid ProductId { get; set; }
        public Guid BranchId { get; set; }
        public string BranchName { get; set; } = "";
        public int Quantity { get; set; }
    }

    private const string ProductSelect = """
        SELECT p.id, p.sku, p.barcode, p.name, p.kind, p.unit_price_cents, p.unit_cost_cents, p.min_stock_qty, p.lead_time_days,
               p.supplier_id, s.name AS supplier_name, p.is_active
        FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
        """;

    public async Task<IReadOnlyList<ProductDto>> ProductsAsync(string? search, bool includeInactive, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewInventory);
        if (search is { Length: > 60 }) throw new RequestValidationException(new ValidationErrors().Add("search", "Use 60 characters or fewer."));
        await using var conn = await db.OpenAsync(ct);
        var products = (await conn.QueryAsync<ProductRow>(
            $"""
            {ProductSelect}
            WHERE p.business_id = @B AND (@All OR p.is_active)
              AND (@Search::text IS NULL OR p.name ILIKE @Search OR p.sku ILIKE @Search OR p.barcode = @Exact)
            ORDER BY p.name LIMIT 500
            """, new { B = access.BusinessId, All = includeInactive, Search = string.IsNullOrWhiteSpace(search) ? null : "%" + LedgerRepository.EscapeLike(search.Trim()) + "%", Exact = search?.Trim() })).ToList();
        var levels = (await LevelsAsync(conn, access)).ToLookup(l => l.ProductId);
        return products.Select(p => ToDto(p, levels[p.Id].ToList())).ToList();
    }

    private static async Task<IReadOnlyList<LevelRow>> LevelsAsync(IDbConnection conn, AccessContext access, IDbTransaction? tx = null) =>
        (await conn.QueryAsync<LevelRow>(
            """
            SELECT l.product_id, l.branch_id, b.name AS branch_name, l.quantity
            FROM inventory_levels l JOIN branches b ON b.id = l.branch_id
            WHERE l.business_id = @B AND (@Branches::uuid[] IS NULL OR l.branch_id = ANY(@Branches::uuid[]))
            ORDER BY b.created_at
            """, new { B = access.BusinessId, Branches = access.BranchFilter }, tx)).ToList();

    private static ProductDto ToDto(ProductRow p, IReadOnlyList<LevelRow> levels) =>
        new(p.Id, p.Sku, p.Barcode, p.Name, p.Kind, p.UnitPriceCents, p.UnitCostCents, p.MinStockQty, p.LeadTimeDays, p.SupplierId, p.SupplierName,
            p.IsActive, levels.Sum(l => l.Quantity),
            levels.Select(l => new StockLevelDto(l.BranchId, l.BranchName, l.Quantity, p.Kind == "product" && p.MinStockQty > 0 && l.Quantity <= p.MinStockQty)).ToList());

    private async Task<ValidationErrors> ValidateProductAsync(IDbConnection conn, Guid businessId, ProductInput i)
    {
        var e = new ValidationErrors();
        if (string.IsNullOrWhiteSpace(i.Sku) || !SkuPattern().IsMatch(i.Sku.Trim())) e.Add("sku", "Use 1–40 letters, numbers, '.', '-' or '_'.");
        if (!string.IsNullOrWhiteSpace(i.Barcode) && !BarcodePattern().IsMatch(i.Barcode.Trim())) e.Add("barcode", "A barcode is 6–14 digits.");
        if (string.IsNullOrWhiteSpace(i.Name) || i.Name.Trim().Length > 120) e.Add("name", "Enter a product name (120 characters or fewer).");
        if (i.Kind is not (null or "product" or "service")) e.Add("kind", "Choose product or service.");
        if (i.UnitPriceCents is not (>= 0 and <= 100_000_000)) e.Add("unitPriceCents", "Enter a selling price.");
        if (i.UnitCostCents is < 0 or > 100_000_000) e.Add("unitCostCents", "Enter a valid cost price.");
        if (i.MinStockQty is < 0 or > 100_000) e.Add("minStockQty", "Enter a minimum stock level from 0.");
        if (i.LeadTimeDays is < 0 or > 120) e.Add("leadTimeDays", "Lead time must be 0–120 days.");
        if (i.SupplierId is { } s && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM suppliers WHERE id = @S AND business_id = @B", new { S = s, B = businessId }) == 0)
            e.Add("supplierId", "Choose one of your suppliers.");
        return e;
    }

    public async Task<ProductDto> CreateProductAsync(ProductInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageInventory);
        await using var conn = await db.OpenAsync(ct);
        RequestValidationException.ThrowIfInvalid(await ValidateProductAsync(conn, access.BusinessId, input));
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM products WHERE business_id = @B AND lower(sku) = lower(@Sku)", new { B = access.BusinessId, Sku = input.Sku!.Trim() }) > 0)
            throw new ConflictException("A product with that SKU already exists.");
        var id = await conn.QuerySingleAsync<Guid>(
            """
            INSERT INTO products (business_id, sku, barcode, name, kind, unit_price_cents, unit_cost_cents, min_stock_qty, lead_time_days, supplier_id)
            VALUES (@B, @Sku, @Barcode, @Name, @Kind, @Price, @Cost, @Min, @Lead, @Supplier) RETURNING id
            """, Params(access.BusinessId, input));
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "product_created", "product", id);
        return await ProductAsync(conn, access, id);
    }

    public async Task<ProductDto> UpdateProductAsync(Guid id, ProductInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageInventory);
        await using var conn = await db.OpenAsync(ct);
        RequestValidationException.ThrowIfInvalid(await ValidateProductAsync(conn, access.BusinessId, input));
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM products WHERE business_id = @B AND lower(sku) = lower(@Sku) AND id <> @Id", new { B = access.BusinessId, Sku = input.Sku!.Trim(), Id = id }) > 0)
            throw new ConflictException("A product with that SKU already exists.");
        var n = await conn.ExecuteAsync(
            """
            UPDATE products SET sku = @Sku, barcode = @Barcode, name = @Name, kind = @Kind, unit_price_cents = @Price, unit_cost_cents = @Cost,
                min_stock_qty = @Min, lead_time_days = @Lead, supplier_id = @Supplier, is_active = COALESCE(@Active, is_active), updated_at = now()
            WHERE id = @Id AND business_id = @B
            """, Params(access.BusinessId, input, id));
        if (n == 0) throw new NotFoundException();
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "product_updated", "product", id);
        return await ProductAsync(conn, access, id);
    }

    private static object Params(Guid businessId, ProductInput i, Guid? id = null) => new
    {
        Id = id, Active = i.IsActive, B = businessId, Sku = i.Sku!.Trim(), Barcode = string.IsNullOrWhiteSpace(i.Barcode) ? null : i.Barcode.Trim(), Name = i.Name!.Trim(),
        Kind = i.Kind ?? "product", Price = i.UnitPriceCents, Cost = i.UnitCostCents ?? 0, Min = i.MinStockQty ?? 0, Lead = i.LeadTimeDays, Supplier = i.SupplierId
    };

    private static async Task<ProductDto> ProductAsync(IDbConnection conn, AccessContext access, Guid id)
    {
        var p = await conn.QueryFirstOrDefaultAsync<ProductRow>($"{ProductSelect} WHERE p.business_id = @B AND p.id = @Id", new { B = access.BusinessId, Id = id })
                ?? throw new NotFoundException();
        return ToDto(p, (await LevelsAsync(conn, access)).Where(l => l.ProductId == id).ToList());
    }

    private static async Task<(string Kind, string Name)> StockProductAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, Guid? productId)
    {
        var p = await conn.QueryFirstOrDefaultAsync<ProductRow>("SELECT id, kind, name FROM products WHERE id = @P AND business_id = @B FOR UPDATE",
            new { P = productId, B = businessId }, tx) ?? throw new RequestValidationException(new ValidationErrors().Add("productId", "Choose one of your products."));
        if (p.Kind != "product") throw new RequestValidationException(new ValidationErrors().Add("productId", "Services do not have stock."));
        return (p.Kind, p.Name);
    }

    private static async Task EnsureBranchAsync(IDbConnection conn, IDbTransaction tx, AccessContext access, Guid? branchId, string field)
    {
        if (branchId is not { } b || !access.CanSeeBranch(b) ||
            await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM branches WHERE id = @Id AND business_id = @B AND is_active", new { Id = b, B = access.BusinessId }, tx) == 0)
            throw new RequestValidationException(new ValidationErrors().Add(field, "Choose one of your active branches."));
    }

    public async Task<ProductDto> ReceiveAsync(ReceiveStockInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageInventory);
        var e = new ValidationErrors();
        if (input.Quantity is not (>= 1 and <= 100_000)) e.Add("quantity", "Enter a quantity between 1 and 100 000.");
        if (input.UnitCostCents is < 0 or > 100_000_000) e.Add("unitCostCents", "Enter a valid cost.");
        if (input.Note is { Length: > 300 }) e.Add("note", "Use 300 characters or fewer.");
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        await StockProductAsync(conn, tx, access.BusinessId, input.ProductId);
        await EnsureBranchAsync(conn, tx, access, input.BranchId, "branchId");
        await StockLedger.ApplyAsync(conn, tx, access.BusinessId, input.ProductId!.Value, input.BranchId!.Value, MovementTypes.Received, input.Quantity!.Value,
            string.IsNullOrWhiteSpace(input.Note) ? "Stock received" : input.Note.Trim(), null, access.UserId, unitCostCents: input.UnitCostCents);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "stock_received", "product", input.ProductId);
        tx.Commit();
        return await ProductAsync(conn, access, input.ProductId!.Value);
    }

    /// <summary>Manual stock corrections. People who cannot approve adjustments create a request that waits for approval.</summary>
    public async Task<StockMovementDto> AdjustAsync(AdjustmentInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.RecordStockAdjustment);
        var e = new ValidationErrors();
        var type = input.Type ?? MovementTypes.Adjustment;
        if (!MovementTypes.NeedApproval.Contains(type)) e.Add("type", "Choose adjustment, damaged or return.");
        if (input.QuantityDelta is null or 0 || Math.Abs(input.QuantityDelta.Value) > 100_000) e.Add("quantityDelta", "Enter how many units to add (+) or remove (−).");
        if (type == MovementTypes.Damaged && input.QuantityDelta > 0) e.Add("quantityDelta", "Damaged stock is removed, so use a negative number.");
        if (type == MovementTypes.Return && input.QuantityDelta < 0) e.Add("quantityDelta", "Returned stock comes back, so use a positive number.");
        if (string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Trim().Length > 300) e.Add("reason", "Give a short reason (300 characters or fewer).");
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var (_, name) = await StockProductAsync(conn, tx, access.BusinessId, input.ProductId);
        await EnsureBranchAsync(conn, tx, access, input.BranchId, "branchId");
        var canApprove = access.Can(Permission.ApproveStockAdjustment);
        var id = Guid.NewGuid();
        var key = $"adj:{id}";
        var r = await StockLedger.ApplyAsync(conn, tx, access.BusinessId, input.ProductId!.Value, input.BranchId!.Value, type, input.QuantityDelta!.Value,
            input.Reason!.Trim(), key, access.UserId, status: canApprove ? "applied" : "pending_approval", approvedBy: canApprove ? access.UserId : null);
        if (canApprove)
            await StockLedger.NotifyIfLowAsync(conn, tx, access.BusinessId, input.ProductId.Value, input.BranchId.Value, r, input.QuantityDelta.Value);
        else
            await NotificationRepository.NotifyAsync(conn, tx, access.BusinessId, Permission.ApproveStockAdjustment, "stock_approval", "informational",
                $"Stock adjustment to approve: {name}", $"{(input.QuantityDelta > 0 ? "+" : "")}{input.QuantityDelta} ({type}). Reason: {input.Reason.Trim()}", "/inventory", key, input.BranchId);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, canApprove ? "stock_adjusted" : "stock_adjustment_requested", "product", input.ProductId,
            JsonSerializer.Serialize(new { type, delta = input.QuantityDelta }));
        await JobQueue.EnqueueGrowthRefreshAsync(conn, tx, access.BusinessId);
        tx.Commit();
        return (await MovementsInternalAsync(conn, access, null, null, null, key)).Single();
    }

    public async Task<StockMovementDto> DecideAsync(Guid movementId, bool approve, DecisionInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ApproveStockAdjustment);
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var m = await conn.QueryFirstOrDefaultAsync<MovementRow>(
            "SELECT id, product_id, branch_id, quantity_delta, status, created_by, source_key FROM stock_movements WHERE id = @Id AND business_id = @B FOR UPDATE",
            new { Id = movementId, B = access.BusinessId }, tx) ?? throw new NotFoundException();
        if (!access.CanSeeBranch(m.BranchId)) throw new NotFoundException();
        if (m.Status != "pending_approval") throw new ConflictException("This adjustment was already decided.");
        if (m.CreatedBy == access.UserId && access.Role != Roles.Owner) throw new ForbiddenException("Someone else must approve your own adjustment.");
        if (!approve && string.IsNullOrWhiteSpace(input.Note)) throw new RequestValidationException(new ValidationErrors().Add("note", "Say why you are rejecting it."));
        await conn.ExecuteAsync(
            "UPDATE stock_movements SET status = @S, approved_by = @U, approved_at = now(), reason = left(coalesce(reason, '') || CASE WHEN @N::text IS NULL THEN '' ELSE ' — ' || @N END, 300) WHERE id = @Id",
            new { S = approve ? "applied" : "rejected", U = access.UserId, N = string.IsNullOrWhiteSpace(input.Note) ? null : input.Note.Trim(), Id = movementId }, tx);
        if (approve)
        {
            var r = await StockLedger.ApplyLevelAsync(conn, tx, access.BusinessId, m.ProductId, m.BranchId, m.QuantityDelta);
            await StockLedger.NotifyIfLowAsync(conn, tx, access.BusinessId, m.ProductId, m.BranchId, r, m.QuantityDelta);
        }
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, approve ? "stock_adjustment_approved" : "stock_adjustment_rejected", "stock_movement", movementId);
        await JobQueue.EnqueueGrowthRefreshAsync(conn, tx, access.BusinessId);
        tx.Commit();
        return (await MovementsInternalAsync(conn, access, null, null, null, m.SourceKey)).Single();
    }

    public async Task<ProductDto> TransferAsync(TransferInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageInventory);
        var e = new ValidationErrors();
        if (input.Quantity is not (>= 1 and <= 100_000)) e.Add("quantity", "Enter a quantity between 1 and 100 000.");
        if (input.FromBranchId is not null && input.FromBranchId == input.ToBranchId) e.Add("toBranchId", "Choose a different branch.");
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var (_, name) = await StockProductAsync(conn, tx, access.BusinessId, input.ProductId);
        await EnsureBranchAsync(conn, tx, access, input.FromBranchId, "fromBranchId");
        await EnsureBranchAsync(conn, tx, access, input.ToBranchId, "toBranchId");
        var onHand = await conn.ExecuteScalarAsync<int?>("SELECT quantity FROM inventory_levels WHERE product_id = @P AND branch_id = @Br FOR UPDATE",
            new { P = input.ProductId, Br = input.FromBranchId }, tx) ?? 0;
        if (onHand < input.Quantity) throw new ConflictException($"Only {onHand} of {name} at the sending branch.");
        var group = Guid.NewGuid();
        var note = string.IsNullOrWhiteSpace(input.Note) ? "Branch transfer" : input.Note.Trim()[..Math.Min(300, input.Note.Trim().Length)];
        var r = await StockLedger.ApplyAsync(conn, tx, access.BusinessId, input.ProductId!.Value, input.FromBranchId!.Value, MovementTypes.TransferOut, -input.Quantity!.Value,
            note, $"xfer:{group}:out", access.UserId, transferGroup: group);
        await StockLedger.ApplyAsync(conn, tx, access.BusinessId, input.ProductId.Value, input.ToBranchId!.Value, MovementTypes.TransferIn, input.Quantity.Value,
            note, $"xfer:{group}:in", access.UserId, transferGroup: group);
        await StockLedger.NotifyIfLowAsync(conn, tx, access.BusinessId, input.ProductId.Value, input.FromBranchId.Value, r, -input.Quantity.Value);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "stock_transferred", "product", input.ProductId);
        tx.Commit();
        return await ProductAsync(conn, access, input.ProductId.Value);
    }

    private sealed class MovementRow
    {
        public Guid Id { get; set; }
        public Guid ProductId { get; set; }
        public string ProductName { get; set; } = "";
        public Guid BranchId { get; set; }
        public string BranchName { get; set; } = "";
        public string MovementType { get; set; } = "";
        public int QuantityDelta { get; set; }
        public long? UnitCostCents { get; set; }
        public string Status { get; set; } = "";
        public string? Reason { get; set; }
        public string? SourceKey { get; set; }
        public Guid? TransactionId { get; set; }
        public Guid? ProviderPaymentId { get; set; }
        public Guid? CreatedBy { get; set; }
        public string? CreatedByName { get; set; }
        public Guid? ApprovedBy { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    public async Task<IReadOnlyList<StockMovementDto>> MovementsAsync(Guid? productId, Guid? branchId, string? status, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewInventory);
        if (status is not (null or "applied" or "pending_approval" or "rejected")) throw new RequestValidationException(new ValidationErrors().Add("status", "Unknown status."));
        await using var conn = await db.OpenAsync(ct);
        return await MovementsInternalAsync(conn, access, productId, branchId, status, null);
    }

    private static async Task<IReadOnlyList<StockMovementDto>> MovementsInternalAsync(IDbConnection conn, AccessContext access, Guid? productId, Guid? branchId, string? status, string? sourceKey) =>
        (await conn.QueryAsync<MovementRow>(
            """
            SELECT sm.id, sm.product_id, p.name AS product_name, sm.branch_id, b.name AS branch_name, sm.movement_type, sm.quantity_delta, sm.unit_cost_cents,
                   sm.status, sm.reason, sm.source_key, sm.transaction_id, sm.provider_payment_id, sm.created_by,
                   COALESCE(m.display_name, m.email) AS created_by_name, sm.approved_by, sm.created_at
            FROM stock_movements sm JOIN products p ON p.id = sm.product_id JOIN branches b ON b.id = sm.branch_id
            LEFT JOIN business_members m ON m.business_id = sm.business_id AND m.user_id = sm.created_by
            WHERE sm.business_id = @B
              AND (@P::uuid IS NULL OR sm.product_id = @P::uuid)
              AND (@Br::uuid IS NULL OR sm.branch_id = @Br::uuid)
              AND (@S::text IS NULL OR sm.status = @S)
              AND (@K::text IS NULL OR sm.source_key = @K)
              AND (@Branches::uuid[] IS NULL OR sm.branch_id = ANY(@Branches::uuid[]))
            ORDER BY sm.created_at DESC LIMIT 200
            """, new { B = access.BusinessId, P = productId, Br = branchId, S = status, K = sourceKey, Branches = access.BranchFilter }))
        .Select(m => new StockMovementDto(m.Id, m.ProductId, m.ProductName, m.BranchId, m.BranchName, m.MovementType, m.QuantityDelta, m.UnitCostCents,
            m.Status, m.Reason,
            m.ProviderPaymentId is not null ? "Payment provider / POS" : m.TransactionId is not null ? "Recorded sale" : m.SourceKey?.StartsWith("xfer:") == true ? "Transfer" : "Staff-recorded",
            m.TransactionId, m.ProviderPaymentId, m.CreatedBy, m.CreatedByName, m.ApprovedBy, m.CreatedAt)).ToList();

    private sealed class SoldRow
    {
        public Guid ProductId { get; set; }
        public Guid BranchId { get; set; }
        public int Units { get; set; }
    }

    /// <summary>Suggestions are calculated on request from recorded movements (nothing is ordered automatically).</summary>
    public async Task<IReadOnlyList<ReorderSuggestionDto>> ReorderAsync(bool onlyNeeded, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewInventory);
        await using var conn = await db.OpenAsync(ct);
        var settings = await BusinessRepository.GetSettingsAsync(conn, null, access.BusinessId);
        var products = (await conn.QueryAsync<ProductRow>($"{ProductSelect} WHERE p.business_id = @B AND p.is_active AND p.kind = 'product'", new { B = access.BusinessId }))
            .ToDictionary(p => p.Id);
        var levels = await LevelsAsync(conn, access);
        var sold = (await conn.QueryAsync<SoldRow>(
            """
            SELECT product_id, branch_id, (-SUM(quantity_delta))::int AS units FROM stock_movements
            WHERE business_id = @B AND status = 'applied' AND movement_type IN ('sold','sale_reversal') AND created_at > now() - make_interval(days => @Days)
            GROUP BY product_id, branch_id
            """, new { B = access.BusinessId, Days = SalesWindowDays })).ToDictionary(s => (s.ProductId, s.BranchId), s => Math.Max(0, s.Units));
        var result = new List<ReorderSuggestionDto>();
        foreach (var l in levels)
        {
            if (!products.TryGetValue(l.ProductId, out var p)) continue;
            var s = ReorderCalculator.Calculate(new ReorderInput(p.Id, p.Name, l.Quantity, p.MinStockQty, p.LeadTimeDays,
                sold.GetValueOrDefault((p.Id, l.BranchId)), SalesWindowDays, settings.ReorderSafetyDays, settings.ReorderCoverDays, settings.DefaultLeadTimeDays));
            if (onlyNeeded && s.SuggestedQuantity == 0) continue;
            result.Add(new ReorderSuggestionDto(p.Id, p.Sku, p.Name, l.BranchId, l.BranchName, s.OnHand, s.MinStock, s.AverageDailySales, s.LeadTimeDays,
                s.ReorderPoint, s.SuggestedQuantity, s.SuggestedQuantity * p.UnitCostCents, s.IsLowStock, s.InsufficientHistory, p.SupplierName,
                [.. s.Assumptions, "This is a suggestion only. KasiFlow never places orders for you."]));
        }
        return result.OrderByDescending(r => r.IsLowStock).ThenBy(r => r.Name).ToList();
    }
}
