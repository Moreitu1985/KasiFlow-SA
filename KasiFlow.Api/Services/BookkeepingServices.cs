using System.Data;
using KasiFlow.Api.Data;
using KasiFlow.Core.Access;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Middleware;
using KasiFlow.Api.Repositories;
using KasiFlow.Api.Validators;
using KasiFlow.Core.Common;
using KasiFlow.Core.Domain;
using KasiFlow.Core.Finance;
using KasiFlow.Core.Validation;

namespace KasiFlow.Api.Services;

public sealed class TransactionService(IDbConnectionFactory db, IBusinessContext business, ICurrentUser user, IClock clock)
{
    public async Task<PagedResult<TransactionDto>> ListAsync(TransactionQuery q, CancellationToken ct)
    {
        var e = RequestValidators.Paging(q.Page, q.PageSize);
        if (q.Type is not null) e.OneOf("type", q.Type, TransactionTypes.All);
        if (q.Status is not null && q.Status != "all") e.OneOf("status", q.Status, TransactionStatuses.All);
        if (q.Origin is not null) e.OneOf("origin", q.Origin, Core.Integrations.RecordOrigins.All);
        if (q.From is { } f && q.To is { } t && t < f) e.Add("to", "'to' must be on or after 'from'.");
        e.Optional("search", q.Search, 100);
        RequestValidationException.ThrowIfInvalid(e);

        var access = await business.RequireAsync(Permission.ViewFinancials, Permission.RecordSales, Permission.RecordExpenses);
        await using var conn = await db.OpenAsync(ct);
        // Branch-scoped roles only ever see their own branches (enforced in SQL, not in the browser).
        var (rows, total) = await LedgerRepository.ListAsync(conn, access.BusinessId, q with { AllowedBranches = access.BranchFilter });
        return PagedResult<TransactionDto>.Create(rows.Select(r => r.ToDto()).ToList(), q.Page, q.PageSize, total);
    }

    public async Task<IReadOnlyList<TransactionDto>> RecentAsync(int limit, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewFinancials, Permission.RecordSales);
        await using var conn = await db.OpenAsync(ct);
        return (await LedgerRepository.RecentAsync(conn, access.BusinessId, Math.Clamp(limit, 1, 50), access.BranchFilter)).Select(r => r.ToDto()).ToList();
    }

    public async Task<TransactionDto> GetAsync(Guid id, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewFinancials, Permission.RecordSales);
        await using var conn = await db.OpenAsync(ct);
        var row = await LedgerRepository.GetAsync(conn, access.BusinessId, id) ?? throw new NotFoundException("Transaction not found.");
        if (!access.CanSeeBranch(row.BranchId)) throw new NotFoundException("Transaction not found.");
        return row.ToDto();
    }

    /// <summary>Picks the branch for a new record: the one given (if the user may use it), or the only one available.</summary>
    internal static async Task<Guid?> ResolveBranchAsync(IDbConnection conn, IDbTransaction? tx, AccessContext access, Guid? requested)
    {
        var active = (await Dapper.SqlMapper.QueryAsync<Guid>(conn, "SELECT id FROM branches WHERE business_id = @B AND is_active ORDER BY created_at",
            new { B = access.BusinessId }, tx)).ToList();
        if (requested is { } r)
        {
            if (!active.Contains(r) || !access.CanSeeBranch(r))
                throw new RequestValidationException(new ValidationErrors().Add("branchId", "Choose one of your branches."));
            return r;
        }
        var allowed = access.AllBranches ? active : active.Where(access.BranchIds.Contains).ToList();
        if (allowed.Count == 1) return allowed[0];
        if (allowed.Count == 0)
        {
            if (!access.AllBranches) throw new ForbiddenException("You are not assigned to a branch yet. Ask the owner to assign you.");
            return null;
        }
        throw new RequestValidationException(new ValidationErrors().Add("branchId", "Choose the branch for this record."));
    }

    public async Task<TransactionDto> CreateAsync(TransactionInput input, CancellationToken ct, string? idempotencyKey = null)
    {
        RequestValidationException.ThrowIfInvalid(RequestValidators.Transaction(input, clock.Today));
        var access = await business.RequireAsync(Permission.ManageFinancials, Permission.RecordSales, Permission.RecordExpenses);
        var businessId = access.BusinessId;
        var key = string.IsNullOrWhiteSpace(idempotencyKey) ? null : idempotencyKey.Trim();
        if (key is { Length: > 100 }) throw new RequestValidationException(new ValidationErrors().Add("idempotencyKey", "Use 100 characters or fewer."));

        if (!access.Can(Permission.ManageFinancials))
        {
            // Limited roles record what actually happened today-ish: posted sales (RecordSales) or posted expenses (RecordExpenses).
            var allowedType = input.Type == TransactionTypes.Income ? access.Can(Permission.RecordSales) : access.Can(Permission.RecordExpenses);
            if (!allowedType || (input.Status ?? TransactionStatuses.Posted) != TransactionStatuses.Posted
                || (input.PaymentStatus ?? PaymentStatuses.RecordedManually) != PaymentStatuses.RecordedManually)
                throw new ForbiddenException(access.Can(Permission.RecordExpenses) && access.Can(Permission.RecordSales)
                    ? "Your role can record posted sales and expenses only." : access.Can(Permission.RecordExpenses) ? "Your role can record expenses only." : "Your role can record sales only.");
        }
        var lines = input.LineItems ?? [];
        var le = new ValidationErrors();
        if (lines.Count > 30) le.Add("lineItems", "Use 30 lines or fewer.");
        if (lines.Count > 0 && input.Type != TransactionTypes.Income) le.Add("lineItems", "Product lines can only be added to sales.");
        for (var i = 0; i < lines.Count; i++)
            if (lines[i].ProductId is null || lines[i].Quantity is not (>= 1 and <= 1000)) le.Add($"lineItems[{i}]", "Choose a product and a quantity between 1 and 1000.");
        RequestValidationException.ThrowIfInvalid(le);

        await using var conn = await db.OpenAsync(ct);
        if (key is not null && await LedgerRepository.FindByIdempotencyKeyAsync(conn, businessId, key) is { } existingId)
            return (await LedgerRepository.GetAsync(conn, businessId, existingId))!.ToDto();

        await using var tx = await conn.BeginTransactionAsync(ct);
        var branchId = await ResolveBranchAsync(conn, tx, access, input.BranchId);
        if (lines.Count > 0 && branchId is null) throw new RequestValidationException(new ValidationErrors().Add("branchId", "Choose a branch so stock can be reduced."));
        // Cash sales are attached to the recorder's open shift so cash-up can be calculated automatically.
        Guid? shiftId = null;
        if (branchId is not null && input.PaymentMethod == PaymentMethods.Cash)
            shiftId = await Dapper.SqlMapper.QueryFirstOrDefaultAsync<Guid?>(conn,
                "SELECT id FROM shifts WHERE business_id = @B AND branch_id = @Br AND staff_user_id = @U AND status = 'open'",
                new { B = businessId, Br = branchId, U = user.UserId }, tx);

        Guid id;
        try
        {
            id = await LedgerRepository.InsertAsync(conn, tx, businessId, user.UserId, input.Type!, input.Description!.Trim(),
                input.AmountCents!.Value, input.Category!, input.TransactionDate!.Value, input.PaymentMethod!,
                input.PaymentStatus ?? PaymentStatuses.RecordedManually, input.Status ?? TransactionStatuses.Posted,
                TransactionSources.Manual, Clean(input.Reference), Clean(input.Notes), Core.Integrations.RecordOrigins.StaffRecorded,
                branchId, shiftId, null, key);
        }
        catch (Exception ex) when (key is not null && PostgresErrors.IsUniqueViolation(ex))
        {
            await tx.RollbackAsync(ct);
            var again = await LedgerRepository.FindByIdempotencyKeyAsync(conn, businessId, key) ?? throw new ConflictException("Duplicate request.");
            return (await LedgerRepository.GetAsync(conn, businessId, again))!.ToDto();
        }

        for (var i = 0; i < lines.Count; i++)
        {
            var product = await Dapper.SqlMapper.QueryFirstOrDefaultAsync<string>(conn,
                "SELECT kind FROM products WHERE id = @P AND business_id = @B AND is_active", new { P = lines[i].ProductId, B = businessId }, tx)
                ?? throw new RequestValidationException(new ValidationErrors().Add($"lineItems[{i}]", "Product not found."));
            if (product != "product") continue; // services carry no stock
            var r = await StockLedger.ApplyAsync(conn, tx, businessId, lines[i].ProductId!.Value, branchId!.Value, Core.Inventory.MovementTypes.Sold,
                -lines[i].Quantity!.Value, "Recorded sale", $"tx:{id}:{i}", user.UserId, transactionId: id);
            await StockLedger.NotifyIfLowAsync(conn, tx, businessId, lines[i].ProductId!.Value, branchId.Value, r, -lines[i].Quantity!.Value);
        }
        await AuditRepository.WriteAsync(conn, tx, businessId, user.UserId, "transaction.created", "transaction", id);
        await JobQueue.EnqueueGrowthRefreshAsync(conn, tx, businessId);
        await tx.CommitAsync(ct);
        return (await LedgerRepository.GetAsync(conn, businessId, id))!.ToDto();
    }

    public async Task<TransactionDto> UpdateAsync(Guid id, TransactionInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(RequestValidators.Transaction(input, clock.Today));
        var access = await business.RequireAsync(Permission.ManageFinancials);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        var existing = await LedgerRepository.GetAsync(conn, businessId, id, tx, forUpdate: true) ?? throw new NotFoundException("Transaction not found.");
        if (!access.CanSeeBranch(existing.BranchId)) throw new NotFoundException("Transaction not found.");
        if (existing.Status == TransactionStatuses.Voided)
            throw new ConflictException("A voided transaction cannot be edited.");
        if (existing.Source != TransactionSources.Manual)
            throw new ConflictException("This transaction was created automatically (debt/bill payment or payment provider) and cannot be edited.");
        if (existing.ProviderPaymentId is not null && (input.AmountCents != existing.AmountCents || input.Type != existing.Type
                || (input.Status ?? TransactionStatuses.Posted) != existing.Status || input.TransactionDate != existing.TransactionDate))
            throw new ConflictException("This sale is matched to a confirmed provider payment. Unmatch it in Reconciliation before changing its amount, type, status or date.");
        if (input.BranchId is { } b) await ResolveBranchAsync(conn, tx, access, b);

        var normalized = input with
        {
            PaymentStatus = existing.ProviderPaymentId is not null ? existing.PaymentStatus : input.PaymentStatus ?? PaymentStatuses.RecordedManually,
            Status = input.Status ?? TransactionStatuses.Posted
        };
        await LedgerRepository.UpdateManualAsync(conn, tx, businessId, id, normalized);
        await AuditRepository.WriteAsync(conn, tx, businessId, user.UserId, "transaction.updated", "transaction", id);
        await JobQueue.EnqueueGrowthRefreshAsync(conn, tx, businessId);
        await tx.CommitAsync(ct);
        return (await LedgerRepository.GetAsync(conn, businessId, id))!.ToDto();
    }

    /// <summary>Voids (never deletes) a transaction. If it was a debt or bill payment, the related
    /// debt/bill balance is restored atomically so nothing is double counted or lost.</summary>
    public async Task<TransactionDto> VoidAsync(Guid id, VoidInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(RequestValidators.Reason(input.Reason));
        var access = await business.RequireAsync(Permission.VoidTransactions);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        var existing = await LedgerRepository.GetAsync(conn, businessId, id, tx, forUpdate: true) ?? throw new NotFoundException("Transaction not found.");
        if (!access.CanSeeBranch(existing.BranchId)) throw new NotFoundException("Transaction not found.");
        if (existing.Status == TransactionStatuses.Voided) throw new ConflictException("This transaction is already voided.");
        if (existing.Source is TransactionSources.ProviderPayment or TransactionSources.ProviderRefund or TransactionSources.ProviderFee)
            throw new ConflictException("This record comes from a payment provider. Use Reconciliation (unmatch) or a refund through the provider instead of voiding it.");
        if (existing.ProviderPaymentId is not null)
            throw new ConflictException("This sale is matched to a confirmed provider payment. Unmatch it in Reconciliation first.");

        await LedgerRepository.VoidAsync(conn, tx, businessId, id, input.Reason!.Trim());

        // Return stock taken by this sale's product lines (once).
        var sold = await Dapper.SqlMapper.QueryAsync<(Guid ProductId, Guid BranchId, int Delta, string SourceKey)>(conn,
            "SELECT product_id, branch_id, quantity_delta, source_key FROM stock_movements sm WHERE business_id = @B AND transaction_id = @T AND movement_type = 'sold' AND status = 'applied' AND source_key LIKE 'tx:%' AND NOT EXISTS (SELECT 1 FROM stock_movements b WHERE b.source_key = sm.source_key || ':back')",
            new { B = businessId, T = id }, tx);
        foreach (var m in sold)
            await StockLedger.ApplyAsync(conn, tx, businessId, m.ProductId, m.BranchId, Core.Inventory.MovementTypes.SaleReversal, -m.Delta,
                "Sale voided", m.SourceKey + ":back", user.UserId, transactionId: id);

        if (await ReceivableRepository.ReceivableForTransactionAsync(conn, tx, businessId, id) is { } receivableId)
        {
            await ReceivableRepository.LockAsync(conn, tx, businessId, receivableId);
            var r = (await ReceivableRepository.GetAsync(conn, businessId, receivableId, tx))!;
            if (r.Status == ReceivableStatuses.WrittenOff)
                throw new ConflictException("This payment belongs to a debt that has been written off. Voiding it would change a closed debt, so it is not allowed.");
            // Paid amounts exclude voided payments, so this is the balance after the void.
            var remainingAfterVoid = BalanceMath.Remaining(r.OriginalAmountCents,
                Math.Min(r.PaidCents, r.OriginalAmountCents), Math.Min(r.WrittenOffCents, r.OriginalAmountCents));
            if (r.Status == ReceivableStatuses.Settled && remainingAfterVoid > 0)
                await ReceivableRepository.SetStatusAsync(conn, tx, businessId, receivableId, ReceivableStatuses.Open);
        }
        if (await PayableRepository.PayableForTransactionAsync(conn, tx, businessId, id) is { } payableId)
        {
            await PayableRepository.LockAsync(conn, tx, businessId, payableId);
            var p = (await PayableRepository.GetAsync(conn, businessId, payableId, tx))!;
            var remainingAfterVoid = BalanceMath.Remaining(p.OriginalAmountCents, Math.Min(p.PaidCents, p.OriginalAmountCents));
            if (p.Status == PayableStatuses.Paid && remainingAfterVoid > 0)
                await PayableRepository.SetStatusAsync(conn, tx, businessId, payableId, PayableStatuses.Open);
        }

        await AuditRepository.WriteAsync(conn, tx, businessId, user.UserId, "transaction.voided", "transaction", id);
        await JobQueue.EnqueueGrowthRefreshAsync(conn, tx, businessId);
        await tx.CommitAsync(ct);
        return (await LedgerRepository.GetAsync(conn, businessId, id))!.ToDto();
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}

public sealed class ContactService(IDbConnectionFactory db, IBusinessContext business)
{
    public async Task<IReadOnlyList<CustomerDto>> ListCustomersAsync(string? search, bool includeArchived, CancellationToken ct) =>
        (await ListAsync(PartyRepository.Kind.Customer, search, includeArchived, ct)).Select(p => p.ToCustomer()).ToList();

    public async Task<IReadOnlyList<SupplierDto>> ListSuppliersAsync(string? search, bool includeArchived, CancellationToken ct) =>
        (await ListAsync(PartyRepository.Kind.Supplier, search, includeArchived, ct)).Select(p => p.ToSupplier()).ToList();

    public async Task<CustomerDto> GetCustomerAsync(Guid id, CancellationToken ct) => (await GetAsync(PartyRepository.Kind.Customer, id, ct)).ToCustomer();
    public async Task<SupplierDto> GetSupplierAsync(Guid id, CancellationToken ct) => (await GetAsync(PartyRepository.Kind.Supplier, id, ct)).ToSupplier();

    public async Task<CustomerDto> CreateCustomerAsync(ContactInput i, CancellationToken ct) => (await CreateAsync(PartyRepository.Kind.Customer, i, ct)).ToCustomer();
    public async Task<SupplierDto> CreateSupplierAsync(ContactInput i, CancellationToken ct) => (await CreateAsync(PartyRepository.Kind.Supplier, i, ct)).ToSupplier();

    public async Task<CustomerDto> UpdateCustomerAsync(Guid id, ContactInput i, CancellationToken ct) => (await UpdateAsync(PartyRepository.Kind.Customer, id, i, ct)).ToCustomer();
    public async Task<SupplierDto> UpdateSupplierAsync(Guid id, ContactInput i, CancellationToken ct) => (await UpdateAsync(PartyRepository.Kind.Supplier, id, i, ct)).ToSupplier();

    private async Task<IReadOnlyList<Models.PartyRow>> ListAsync(PartyRepository.Kind kind, string? search, bool includeArchived, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(new ValidationErrors().Optional("search", search, 100));
        var access = await business.RequireAsync(Permission.ViewFinancials);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        return await PartyRepository.ListAsync(conn, kind, businessId, search, includeArchived);
    }

    private async Task<Models.PartyRow> GetAsync(PartyRepository.Kind kind, Guid id, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewFinancials);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        return await PartyRepository.GetAsync(conn, kind, businessId, id) ?? throw new NotFoundException($"{kind} not found.");
    }

    private async Task<Models.PartyRow> CreateAsync(PartyRepository.Kind kind, ContactInput i, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(RequestValidators.Contact(i));
        var access = await business.RequireAsync(Permission.ManageFinancials);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        var id = await PartyRepository.InsertAsync(conn, kind, businessId, i);
        return (await PartyRepository.GetAsync(conn, kind, businessId, id))!;
    }

    private async Task<Models.PartyRow> UpdateAsync(PartyRepository.Kind kind, Guid id, ContactInput i, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(RequestValidators.Contact(i));
        var access = await business.RequireAsync(Permission.ManageFinancials);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        if (await PartyRepository.UpdateAsync(conn, kind, businessId, id, i) == 0) throw new NotFoundException($"{kind} not found.");
        return (await PartyRepository.GetAsync(conn, kind, businessId, id))!;
    }
}

public sealed class ReceivableService(IDbConnectionFactory db, IBusinessContext business, ICurrentUser user, IClock clock)
{
    public async Task<PagedResult<ReceivableDto>> ListAsync(string? status, string? filter, Guid? customerId, int page, int pageSize, CancellationToken ct)
    {
        var e = RequestValidators.Paging(page, pageSize);
        if (status is not null && status != "all") e.OneOf("status", status, ReceivableStatuses.All);
        if (filter is not null) e.OneOf("filter", filter, new HashSet<string> { "all", "overdue", "upcoming" });
        RequestValidationException.ThrowIfInvalid(e);
        var access = await business.RequireAsync(Permission.ViewFinancials, Permission.RecordDebtPayments);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        var (rows, total) = await ReceivableRepository.ListAsync(conn, businessId, clock.Today, status, filter, customerId, page, pageSize);
        return PagedResult<ReceivableDto>.Create(rows.Select(r => r.ToDto(clock.Today)).ToList(), page, pageSize, total);
    }

    public async Task<ReceivableSummaryDto> SummaryAsync(CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewFinancials, Permission.RecordDebtPayments);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        var open = await ReceivableRepository.OpenAsync(conn, businessId);
        return Summarise(open, clock.Today);
    }

    public static ReceivableSummaryDto Summarise(IReadOnlyList<Core.Forecasting.OpenReceivable> open, DateOnly today)
    {
        var upcomingEnd = today.AddDays(13);
        return new ReceivableSummaryDto(
            open.Sum(r => r.RemainingCents),
            open.Where(r => r.DueDate is { } d && d < today).Sum(r => r.RemainingCents),
            open.Where(r => r.DueDate is { } d && d >= today && d <= upcomingEnd).Sum(r => r.RemainingCents),
            open.Count,
            open.GroupBy(r => (r.CustomerId, r.CustomerName))
                .Select(g => new TopDebtorDto(g.Key.CustomerId, g.Key.CustomerName, g.Sum(r => r.RemainingCents)))
                .OrderByDescending(t => t.OutstandingCents).ThenBy(t => t.CustomerName).Take(5).ToList());
    }

    public async Task<ReceivableDetailDto> GetAsync(Guid id, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewFinancials, Permission.RecordDebtPayments);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        return await LoadDetailAsync(conn, businessId, id, null);
    }

    /// <summary>Records an amount owed. No cash has moved, so no income transaction is created.</summary>
    public async Task<ReceivableDetailDto> CreateAsync(ReceivableInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(RequestValidators.Receivable(input, clock.Today));
        if (input.Reference is { Length: > 80 }) throw new RequestValidationException(new ValidationErrors().Add("reference", "Use 80 characters or fewer."));
        var access = await business.RequireAsync(Permission.ManageFinancials, Permission.RecordDebtPayments);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        if (!await PartyRepository.ExistsAsync(conn, null, PartyRepository.Kind.Customer, businessId, input.CustomerId!.Value))
            throw new RequestValidationException(new ValidationErrors().Add("customerId", "Customer not found."));
        var policy = await Barbershop.PolicyRepository.GetAsync(conn, businessId);
        // Terms are recorded on the debt only when the policy is active and the customer was shown them now.
        var disclosed = input.ChargeTermsDisclosed && policy.DebtChargeEnabled && !string.IsNullOrWhiteSpace(policy.DebtChargeTerms) ? policy : null;
        var id = await ReceivableRepository.InsertAsync(conn, businessId, input, disclosed);
        await AuditRepository.WriteAsync(conn, null, businessId, user.UserId, "receivable.created", "receivable", id,
            System.Text.Json.JsonSerializer.Serialize(new { chargeTermsDisclosed = disclosed is not null }));
        return await LoadDetailAsync(conn, businessId, id, null);
    }

    /// <summary>Records a (partial) customer payment: one income transaction + one payment link, in one
    /// database transaction, with the debt row locked to prevent overpayment by concurrent requests.</summary>
    public async Task<ReceivableDetailDto> RecordPaymentAsync(Guid id, PaymentInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(RequestValidators.Payment(input, clock.Today));
        var access = await business.RequireAsync(Permission.ManageFinancials, Permission.RecordDebtPayments);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        if (!await ReceivableRepository.LockAsync(conn, tx, businessId, id)) throw new NotFoundException("Debt not found.");
        var r = (await ReceivableRepository.GetAsync(conn, businessId, id, tx))!;
        if (r.Status != ReceivableStatuses.Open) throw new ConflictException($"This debt is {r.Status.Replace('_', ' ')} and cannot receive payments.");
        if (input.PaymentDate < r.IssueDate)
            throw new RequestValidationException(new ValidationErrors().Add("paymentDate", "The payment date cannot be before the debt was issued."));

        var remaining = r.Remaining();
        switch (BalanceMath.CheckPayment(remaining, input.AmountCents!.Value))
        {
            case PaymentCheck.AlreadySettled: throw new ConflictException("This debt is already fully paid.");
            case PaymentCheck.ExceedsRemaining: throw new ConflictException($"The payment is more than the remaining balance of {Money.FormatZar(remaining)}.");
        }
        // Guard against the same payment being captured twice (e.g. a double tap or two people recording it).
        if (await Dapper.SqlMapper.ExecuteScalarAsync<int>(conn,
                """
                SELECT COUNT(*) FROM receivable_payments rp JOIN transactions t ON t.id = rp.transaction_id
                WHERE rp.business_id = @B AND rp.receivable_id = @R AND rp.amount_cents = @A AND rp.payment_date = @D AND t.status <> 'voided'
                  AND rp.created_at > now() - interval '10 minutes'
                """, new { B = businessId, R = id, A = input.AmountCents, D = input.PaymentDate }, tx) > 0 && !input.ConfirmDuplicate)
            throw new ConflictException("The same payment was recorded a few minutes ago. If this really is a second payment, confirm it as a separate payment.");

        var txId = await LedgerRepository.InsertAsync(conn, tx, businessId, user.UserId, TransactionTypes.Income,
            Truncate($"Payment from {r.CustomerName}: {r.Description}", 200), input.AmountCents.Value, Categories.DebtCollection,
            input.PaymentDate!.Value, input.PaymentMethod!, PaymentStatuses.RecordedManually, TransactionStatuses.Posted,
            TransactionSources.ReceivablePayment, Clean(input.Reference), null);
        await ReceivableRepository.InsertPaymentAsync(conn, tx, businessId, id, txId, input.AmountCents.Value, input.PaymentDate.Value);
        var newRemaining = remaining - input.AmountCents.Value;
        await ReceivableRepository.SetStatusAsync(conn, tx, businessId, id, BalanceMath.ReceivableStatusAfter(newRemaining, r.Status));
        await AuditRepository.WriteAsync(conn, tx, businessId, user.UserId, "receivable.payment_recorded", "receivable", id);
        await tx.CommitAsync(ct);
        return await LoadDetailAsync(conn, businessId, id, null);
    }

    public async Task<ReceivableDetailDto> WriteOffAsync(Guid id, ReasonInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(RequestValidators.Reason(input.Reason));
        var access = await business.RequireAsync(Permission.ManageFinancials);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        if (!await ReceivableRepository.LockAsync(conn, tx, businessId, id)) throw new NotFoundException("Debt not found.");
        var r = (await ReceivableRepository.GetAsync(conn, businessId, id, tx))!;
        if (r.Status != ReceivableStatuses.Open) throw new ConflictException("Only open debts can be written off.");
        await ReceivableRepository.WriteOffAsync(conn, tx, businessId, id, r.Balance(clock.Today).PrincipalOutstandingCents, input.Reason!.Trim());
        await Dapper.SqlMapper.ExecuteAsync(conn, "UPDATE receivable_charges SET status = 'waived', decided_by = @U, decided_at = now(), decision_reason = 'Debt written off' WHERE receivable_id = @Id AND business_id = @B AND status IN ('applied','proposed')",
            new { U = user.UserId, Id = id, B = businessId }, tx);
        await AuditRepository.WriteAsync(conn, tx, businessId, user.UserId, "receivable.written_off", "receivable", id);
        await tx.CommitAsync(ct);
        return await LoadDetailAsync(conn, businessId, id, null);
    }

    private async Task<ReceivableDetailDto> LoadDetailAsync(IDbConnection conn, Guid businessId, Guid id, IDbTransaction? tx)
    {
        var r = await ReceivableRepository.GetAsync(conn, businessId, id, tx) ?? throw new NotFoundException("Debt not found.");
        var payments = await ReceivableRepository.PaymentsAsync(conn, businessId, id, tx);
        return r.ToDetail(clock.Today, payments);
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    internal static string Truncate(string s, int max) => s.Length <= max ? s : s[..(max - 1)] + "…";
}

public sealed class PayableService(IDbConnectionFactory db, IBusinessContext business, ICurrentUser user, IClock clock)
{
    public async Task<PagedResult<PayableDto>> ListAsync(string? status, string? filter, Guid? supplierId, int page, int pageSize, CancellationToken ct)
    {
        var e = RequestValidators.Paging(page, pageSize);
        if (status is not null && status != "all") e.OneOf("status", status, PayableStatuses.All);
        if (filter is not null) e.OneOf("filter", filter, new HashSet<string> { "all", "overdue", "due_soon" });
        RequestValidationException.ThrowIfInvalid(e);
        var access = await business.RequireAsync(Permission.ViewFinancials);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        var (rows, total) = await PayableRepository.ListAsync(conn, businessId, clock.Today, status, filter, supplierId, page, pageSize);
        return PagedResult<PayableDto>.Create(rows.Select(r => r.ToDto(clock.Today)).ToList(), page, pageSize, total);
    }

    public async Task<PayableSummaryDto> SummaryAsync(CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewFinancials);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        return Summarise(await PayableRepository.OpenAsync(conn, businessId), clock.Today);
    }

    public static PayableSummaryDto Summarise(IReadOnlyList<Core.Forecasting.OpenPayable> open, DateOnly today) =>
        new(open.Sum(p => p.RemainingCents),
            open.Where(p => p.DueDate < today).Sum(p => p.RemainingCents),
            open.Where(p => p.DueDate >= today && p.DueDate <= today.AddDays(6)).Sum(p => p.RemainingCents),
            open.Where(p => p.DueDate >= today && p.DueDate <= today.AddDays(29)).Sum(p => p.RemainingCents),
            open.Count);

    public async Task<PayableDetailDto> GetAsync(Guid id, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewFinancials);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        return await LoadDetailAsync(conn, businessId, id);
    }

    /// <summary>Records a supplier bill. It is not an expense until it is paid (cash basis).</summary>
    public async Task<PayableDetailDto> CreateAsync(PayableInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(RequestValidators.Payable(input));
        var access = await business.RequireAsync(Permission.ManageFinancials);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        if (!await PartyRepository.ExistsAsync(conn, null, PartyRepository.Kind.Supplier, businessId, input.SupplierId!.Value))
            throw new RequestValidationException(new ValidationErrors().Add("supplierId", "Supplier not found."));
        var id = await PayableRepository.InsertAsync(conn, businessId, input);
        await AuditRepository.WriteAsync(conn, null, businessId, user.UserId, "payable.created", "payable", id);
        return await LoadDetailAsync(conn, businessId, id);
    }

    /// <summary>Records a (partial) bill payment: one expense transaction (bill's category) + payment link, atomically.</summary>
    public async Task<PayableDetailDto> RecordPaymentAsync(Guid id, PaymentInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(RequestValidators.Payment(input, clock.Today));
        var access = await business.RequireAsync(Permission.ManageFinancials, Permission.RecordDebtPayments);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        if (!await PayableRepository.LockAsync(conn, tx, businessId, id)) throw new NotFoundException("Bill not found.");
        var p = (await PayableRepository.GetAsync(conn, businessId, id, tx))!;
        if (p.Status != PayableStatuses.Open) throw new ConflictException($"This bill is {p.Status} and cannot receive payments.");
        if (input.PaymentDate < p.BillDate)
            throw new RequestValidationException(new ValidationErrors().Add("paymentDate", "The payment date cannot be before the bill date."));

        var remaining = p.Remaining();
        switch (BalanceMath.CheckPayment(remaining, input.AmountCents!.Value))
        {
            case PaymentCheck.AlreadySettled: throw new ConflictException("This bill is already fully paid.");
            case PaymentCheck.ExceedsRemaining: throw new ConflictException($"The payment is more than the remaining balance of {Money.FormatZar(remaining)}.");
        }
        // Guard against the same payment being captured twice (e.g. a double tap or two people recording it).
        if (await Dapper.SqlMapper.ExecuteScalarAsync<int>(conn,
                """
                SELECT COUNT(*) FROM receivable_payments rp JOIN transactions t ON t.id = rp.transaction_id
                WHERE rp.business_id = @B AND rp.receivable_id = @R AND rp.amount_cents = @A AND rp.payment_date = @D AND t.status <> 'voided'
                  AND rp.created_at > now() - interval '10 minutes'
                """, new { B = businessId, R = id, A = input.AmountCents, D = input.PaymentDate }, tx) > 0 && !input.ConfirmDuplicate)
            throw new ConflictException("The same payment was recorded a few minutes ago. If this really is a second payment, confirm it as a separate payment.");

        var txId = await LedgerRepository.InsertAsync(conn, tx, businessId, user.UserId, TransactionTypes.Expense,
            ReceivableService.Truncate($"Payment to {p.SupplierName}: {p.Description}", 200), input.AmountCents.Value, p.Category,
            input.PaymentDate!.Value, input.PaymentMethod!, PaymentStatuses.RecordedManually, TransactionStatuses.Posted,
            TransactionSources.PayablePayment, string.IsNullOrWhiteSpace(input.Reference) ? null : input.Reference.Trim(), null);
        await PayableRepository.InsertPaymentAsync(conn, tx, businessId, id, txId, input.AmountCents.Value, input.PaymentDate.Value);
        await PayableRepository.SetStatusAsync(conn, tx, businessId, id, BalanceMath.PayableStatusAfter(remaining - input.AmountCents.Value, p.Status));
        await AuditRepository.WriteAsync(conn, tx, businessId, user.UserId, "payable.payment_recorded", "payable", id);
        await tx.CommitAsync(ct);
        return await LoadDetailAsync(conn, businessId, id);
    }

    public async Task<PayableDetailDto> CancelAsync(Guid id, ReasonInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(RequestValidators.Reason(input.Reason));
        var access = await business.RequireAsync(Permission.ManageFinancials);
        var businessId = access.BusinessId;
        await using var conn = await db.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        if (!await PayableRepository.LockAsync(conn, tx, businessId, id)) throw new NotFoundException("Bill not found.");
        var p = (await PayableRepository.GetAsync(conn, businessId, id, tx))!;
        if (p.Status != PayableStatuses.Open) throw new ConflictException("Only open bills can be cancelled.");
        if (p.PaidCents > 0) throw new ConflictException("This bill has payments. Void those payments first, or keep the bill open.");
        await PayableRepository.SetStatusAsync(conn, tx, businessId, id, PayableStatuses.Cancelled, input.Reason!.Trim());
        await AuditRepository.WriteAsync(conn, tx, businessId, user.UserId, "payable.cancelled", "payable", id);
        await tx.CommitAsync(ct);
        return await LoadDetailAsync(conn, businessId, id);
    }

    private async Task<PayableDetailDto> LoadDetailAsync(IDbConnection conn, Guid businessId, Guid id)
    {
        var p = await PayableRepository.GetAsync(conn, businessId, id) ?? throw new NotFoundException("Bill not found.");
        var payments = await PayableRepository.PaymentsAsync(conn, businessId, id);
        return p.ToDetail(clock.Today, payments);
    }
}
