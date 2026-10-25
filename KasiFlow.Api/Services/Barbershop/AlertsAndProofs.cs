using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dapper;
using KasiFlow.Api.Data;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Middleware;
using KasiFlow.Api.Repositories;
using KasiFlow.Core.Access;
using KasiFlow.Core.Common;
using KasiFlow.Core.Domain;
using KasiFlow.Core.Growth;
using KasiFlow.Core.Validation;

namespace KasiFlow.Api.Services;

public static class AlertRepository
{
    /// <summary>Upserts detected alerts by fingerprint. Open alerts whose condition is no longer detected are closed
    /// automatically with a note; alerts someone is reviewing (or has decided) are never changed by the engine.</summary>
    public static async Task SyncAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, IReadOnlyList<RecommendationDraft> drafts)
    {
        foreach (var d in drafts)
        {
            var first = d.Evidence.FirstOrDefault(e => e.SourceId is not null);
            var inserted = await conn.QueryFirstOrDefaultAsync<Guid?>(
                """
                INSERT INTO alerts (business_id, rule_code, fingerprint, severity, title, reason, evidence, affected_type, affected_id, recommended_action)
                VALUES (@B, @Code, @Fp, @Sev, @Title, @Reason, @Evidence::jsonb, @AType, @AId, @Action)
                ON CONFLICT (business_id, fingerprint) DO UPDATE SET last_detected_at = now(), evidence = EXCLUDED.evidence, updated_at = now()
                RETURNING CASE WHEN xmax = 0 THEN id END
                """, new { B = businessId, Code = d.RuleCode, Fp = d.Fingerprint, Sev = d.Severity, Title = d.Title, Reason = d.Explanation,
                    Evidence = JsonSerializer.Serialize(d.Evidence, GrowthRepository.Json), AType = first?.SourceType, AId = first?.SourceId,
                    Action = string.Join(" ", d.Actions) }, tx);
            if (inserted is not null && d.Severity is Severities.Critical or Severities.Warning)
                await NotificationRepository.NotifyAsync(conn, tx, businessId, Permission.ViewAlerts, "alert", d.Severity, d.Title,
                    "Check the evidence in Fraud & Alerts. This is a warning to verify, not proof of wrongdoing.", "/alerts", $"alert:{d.Fingerprint}");
        }
        await conn.ExecuteAsync(
            """
            UPDATE alerts SET status = 'resolved', review_note = 'Closed automatically: the condition is no longer detected.', reviewed_at = now(), updated_at = now()
            WHERE business_id = @B AND status = 'open' AND NOT (fingerprint = ANY(@Fps)) AND NOT (rule_code = ANY(@Manual))
            """, new { B = businessId, Fps = drafts.Select(d => d.Fingerprint).ToArray(), Manual = KasiFlow.Api.Services.Barbershop.SafetyAlertCodes.All }, tx);
    }
}

public sealed record AlertDto(Guid Id, string RuleCode, string Severity, string Title, string Reason, IReadOnlyList<EvidenceDto> Evidence,
    string? AffectedType, Guid? AffectedId, string RecommendedAction, string Status, Guid? ReviewerId, string? ReviewNote, DateTimeOffset? ReviewedAt,
    DateTimeOffset FirstDetectedAt, DateTimeOffset LastDetectedAt);

public sealed record AlertStatusInput(string? Status, string? Note);

public sealed record AlertSummaryDto(int Open, int UnderReview, int Critical, int Warning, IReadOnlyList<AlertDto> Items, string Disclaimer);

/// <summary>Fraud &amp; Alerts Centre: evidence-based warnings that need a person to verify them.</summary>
public sealed class AlertService(IDbConnectionFactory db, IBusinessContext business)
{
    public static readonly string[] Statuses = ["open", "under_review", "resolved", "false_positive"];

    private sealed class Row
    {
        public Guid Id { get; set; }
        public string RuleCode { get; set; } = "";
        public string Severity { get; set; } = "";
        public string Title { get; set; } = "";
        public string Reason { get; set; } = "";
        public string Evidence { get; set; } = "[]";
        public string? AffectedType { get; set; }
        public Guid? AffectedId { get; set; }
        public string RecommendedAction { get; set; } = "";
        public string Status { get; set; } = "";
        public Guid? ReviewerId { get; set; }
        public string? ReviewNote { get; set; }
        public DateTime? ReviewedAt { get; set; }
        public DateTime FirstDetectedAt { get; set; }
        public DateTime LastDetectedAt { get; set; }
    }

    private const string Cols = "id, rule_code, severity, title, reason, evidence::text AS evidence, affected_type, affected_id, recommended_action, status, reviewer_id, review_note, reviewed_at, first_detected_at, last_detected_at";

    private static AlertDto ToDto(Row r) =>
        new(r.Id, r.RuleCode, r.Severity, r.Title, r.Reason,
            (JsonSerializer.Deserialize<List<EvidenceItem>>(r.Evidence, GrowthRepository.Json) ?? [])
                .Select(e => new EvidenceDto(e.SourceType, e.SourceId, e.Label, e.AmountCents, e.Date, e.Detail)).ToList(),
            r.AffectedType, r.AffectedId, r.RecommendedAction, r.Status, r.ReviewerId, r.ReviewNote, Barbershop.TeamRepository.Utc(r.ReviewedAt),
            Barbershop.TeamRepository.Utc(r.FirstDetectedAt), Barbershop.TeamRepository.Utc(r.LastDetectedAt));

    public async Task<AlertSummaryDto> ListAsync(string? status, string? severity, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewAlerts);
        if (status is not null && status != "all" && !Statuses.Contains(status)) throw new RequestValidationException(new ValidationErrors().Add("status", "Unknown status."));
        await using var conn = await db.OpenAsync(ct);
        var rows = (await conn.QueryAsync<Row>(
            $"""
            SELECT {Cols} FROM alerts WHERE business_id = @B
              AND (CASE WHEN @S::text IS NULL THEN status IN ('open','under_review') WHEN @S::text = 'all' THEN TRUE ELSE status = @S END)
              AND (@Sev::text IS NULL OR severity = @Sev)
            ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, last_detected_at DESC LIMIT 200
            """, new { B = access.BusinessId, S = status, Sev = severity })).Select(ToDto).ToList();
        var counts = await conn.QuerySingleAsync<(int Open, int Review, int Crit, int Warn)>(
            """
            SELECT COUNT(*) FILTER (WHERE status = 'open')::int, COUNT(*) FILTER (WHERE status = 'under_review')::int,
                   COUNT(*) FILTER (WHERE status IN ('open','under_review') AND severity = 'critical')::int,
                   COUNT(*) FILTER (WHERE status IN ('open','under_review') AND severity = 'warning')::int
            FROM alerts WHERE business_id = @B
            """, new { B = access.BusinessId });
        return new AlertSummaryDto(counts.Open, counts.Review, counts.Crit, counts.Warn, rows,
            "Alerts are warnings that need checking, not proof of fraud. Look at the evidence and talk to the people involved before drawing conclusions.");
    }

    public async Task<AlertDto> SetStatusAsync(Guid id, AlertStatusInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageAlerts);
        var e = new ValidationErrors();
        if (input.Status is null || !Statuses.Contains(input.Status)) e.Add("status", "Choose open, under_review, resolved or false_positive.");
        if (input.Status is "resolved" or "false_positive" && string.IsNullOrWhiteSpace(input.Note)) e.Add("note", "Write what you checked and found.");
        e.Optional("note", input.Note, 1000);
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        var row = await conn.QueryFirstOrDefaultAsync<Row>(
            $"""
            UPDATE alerts SET status = @S, review_note = COALESCE(@N, review_note), reviewer_id = @U, reviewed_at = now(), updated_at = now()
            WHERE id = @Id AND business_id = @B RETURNING {Cols}
            """, new { S = input.Status, N = string.IsNullOrWhiteSpace(input.Note) ? null : input.Note.Trim(), U = access.UserId, Id = id, B = access.BusinessId })
            ?? throw new NotFoundException();
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "alert_" + input.Status, "alert", id);
        return ToDto(row);
    }
}

public sealed record PaymentProofDto(Guid Id, Guid? TransactionId, Guid? BookingId, Guid? ReceivableId, string FileName, string ContentType, int SizeBytes,
    long? ClaimedAmountCents, string? ClaimedReference, string? PayerName, string Status, string StatusLabel, string? VerificationNote,
    DateTimeOffset? VerifiedAt, DateTimeOffset CreatedAt, bool DuplicateFile, string Warning);

public sealed record ProofDecisionInput(string? Note);

/// <summary>Proof-of-payment files (screenshots / PDFs). Storing a proof never marks money as received. Only a person who
/// has seen the money in the account, or a verified provider payment, can confirm it.</summary>
public sealed class PaymentProofService(IDbConnectionFactory db, IBusinessContext business)
{
    public const int MaxBytes = 2 * 1024 * 1024;
    private const string Warning = "A proof of payment is not proof that money cleared. Check your bank account or payment provider before treating it as paid.";

    private sealed class Row
    {
        public Guid Id { get; set; }
        public Guid? TransactionId { get; set; }
        public Guid? BookingId { get; set; }
        public Guid? ReceivableId { get; set; }
        public string FileName { get; set; } = "";
        public string ContentType { get; set; } = "";
        public int SizeBytes { get; set; }
        public long? ClaimedAmountCents { get; set; }
        public string? ClaimedReference { get; set; }
        public string? PayerName { get; set; }
        public string Status { get; set; } = "";
        public string? VerificationNote { get; set; }
        public DateTime? VerifiedAt { get; set; }
        public DateTime CreatedAt { get; set; }
        public bool DuplicateFile { get; set; }
    }

    private const string Select = """
        SELECT p.id, p.transaction_id, p.booking_id, p.receivable_id, p.file_name, p.content_type, p.size_bytes, p.claimed_amount_cents, p.claimed_reference,
               p.payer_name, p.status, p.verification_note, p.verified_at, p.created_at,
               EXISTS (SELECT 1 FROM payment_proofs o WHERE o.business_id = p.business_id AND o.sha256 = p.sha256 AND o.id <> p.id) AS duplicate_file
        FROM payment_proofs p
        """;

    private static PaymentProofDto ToDto(Row r) =>
        new(r.Id, r.TransactionId, r.BookingId, r.ReceivableId, r.FileName, r.ContentType, r.SizeBytes, r.ClaimedAmountCents, r.ClaimedReference, r.PayerName,
            r.Status, r.Status switch
            {
                "unverified" => "Unverified — not counted as received",
                "verified_by_provider" => "Verified by payment provider",
                "confirmed_in_bank" => "Confirmed in bank account by a person",
                _ => "Rejected"
            }, r.VerificationNote, Barbershop.TeamRepository.Utc(r.VerifiedAt), Barbershop.TeamRepository.Utc(r.CreatedAt), r.DuplicateFile, Warning);

    /// <summary>Detects the real file type from its first bytes; the browser's claimed type is not trusted.</summary>
    public static string? Sniff(ReadOnlySpan<byte> b) =>
        b.Length >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47 ? "image/png"
        : b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF ? "image/jpeg"
        : b.Length >= 5 && b[0] == 0x25 && b[1] == 0x50 && b[2] == 0x44 && b[3] == 0x46 && b[4] == 0x2D ? "application/pdf"
        : null;

    public async Task<PaymentProofDto> UploadAsync(IFormFile? file, Guid? transactionId, Guid? bookingId, Guid? receivableId, long? claimedAmountCents,
        string? claimedReference, string? payerName, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageFinancials, Permission.RecordSales, Permission.RecordDebtPayments);
        var e = new ValidationErrors();
        if (file is null || file.Length == 0) e.Add("file", "Choose the proof file (photo, screenshot or PDF).");
        else if (file.Length > MaxBytes) e.Add("file", "The file must be 2 MB or smaller.");
        if (claimedAmountCents is <= 0 or > 100_000_000) e.Add("claimedAmountCents", "Enter the amount shown on the proof.");
        e.Optional("claimedReference", claimedReference, 80);
        e.Optional("payerName", payerName, 120);
        RequestValidationException.ThrowIfInvalid(e);
        using var ms = new MemoryStream();
        await file!.CopyToAsync(ms, ct);
        var bytes = ms.ToArray();
        var type = Sniff(bytes) ?? throw new RequestValidationException(new ValidationErrors().Add("file", "Only PNG, JPEG or PDF files are accepted."));
        var name = Path.GetFileName(file.FileName);
        name = string.IsNullOrWhiteSpace(name) ? "proof" : new string(name.Where(ch => char.IsLetterOrDigit(ch) || ch is '.' or '-' or '_' or ' ').ToArray()).Trim();
        if (name.Length == 0) name = "proof";
        if (name.Length > 120) name = name[..120];
        await using var conn = await db.OpenAsync(ct);
        var b = access.BusinessId;
        if (transactionId is { } t && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM transactions WHERE id = @Id AND business_id = @B AND type = 'income'", new { Id = t, B = b }) == 0)
            throw new RequestValidationException(new ValidationErrors().Add("transactionId", "Choose one of your income records."));
        if (bookingId is { } bk && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM bookings WHERE id = @Id AND business_id = @B", new { Id = bk, B = b }) == 0)
            throw new RequestValidationException(new ValidationErrors().Add("bookingId", "Booking not found."));
        if (receivableId is { } rv && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM receivables WHERE id = @Id AND business_id = @B", new { Id = rv, B = b }) == 0)
            throw new RequestValidationException(new ValidationErrors().Add("receivableId", "Debt not found."));
        var sha = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var id = await conn.QuerySingleAsync<Guid>(
            """
            INSERT INTO payment_proofs (business_id, transaction_id, booking_id, receivable_id, file_name, content_type, size_bytes, sha256, content,
                claimed_amount_cents, claimed_reference, payer_name, submitted_by)
            VALUES (@B, @T, @Bk, @R, @Name, @Type, @Size, @Sha, @Content, @Amt, @Ref, @Payer, @U) RETURNING id
            """, new { B = b, T = transactionId, Bk = bookingId, R = receivableId, Name = name, Type = type, Size = bytes.Length, Sha = sha, Content = bytes,
                Amt = claimedAmountCents, Ref = Clean(claimedReference), Payer = Clean(payerName), U = access.UserId });
        await AuditRepository.WriteAsync(conn, null, b, access.UserId, "payment_proof_uploaded", "payment_proof", id);
        await JobQueue.EnqueueGrowthRefreshAsync(conn, null, b);
        return ToDto((await conn.QuerySingleAsync<Row>($"{Select} WHERE p.id = @Id", new { Id = id })));
    }

    public async Task<IReadOnlyList<PaymentProofDto>> ListAsync(string? status, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewFinancials, Permission.RecordSales, Permission.RecordDebtPayments);
        await using var conn = await db.OpenAsync(ct);
        return (await conn.QueryAsync<Row>($"{Select} WHERE p.business_id = @B AND (@S::text IS NULL OR p.status = @S) ORDER BY p.created_at DESC LIMIT 200",
            new { B = access.BusinessId, S = status })).Select(ToDto).ToList();
    }

    public async Task<(byte[] Content, string ContentType, string FileName)> FileAsync(Guid id, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewFinancials, Permission.RecordSales, Permission.RecordDebtPayments);
        await using var conn = await db.OpenAsync(ct);
        var r = await conn.QueryFirstOrDefaultAsync<(byte[] C, string T, string N)>(
            "SELECT content, content_type, file_name FROM payment_proofs WHERE id = @Id AND business_id = @B", new { Id = id, B = access.BusinessId });
        if (r.C is null) throw new NotFoundException();
        return (r.C, r.T, r.N);
    }

    /// <summary>A person confirms they saw the money in the bank account (or rejects the proof). Logged with who did it.</summary>
    public async Task<PaymentProofDto> DecideAsync(Guid id, bool confirm, ProofDecisionInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageFinancials);
        if (string.IsNullOrWhiteSpace(input.Note) || input.Note.Length > 300)
            throw new RequestValidationException(new ValidationErrors().Add("note", confirm ? "Say where you saw the money (for example 'FNB app, 16 Oct, ref POP-002')." : "Say why the proof is rejected."));
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var p = await conn.QueryFirstOrDefaultAsync<(string Status, Guid? T)>("SELECT status, transaction_id FROM payment_proofs WHERE id = @Id AND business_id = @B FOR UPDATE",
            new { Id = id, B = access.BusinessId }, tx);
        if (p.Status is null) throw new NotFoundException();
        if (p.Status != "unverified") throw new ConflictException("This proof was already decided.");
        await conn.ExecuteAsync("UPDATE payment_proofs SET status = @S, verification_note = @N, verified_by = @U, verified_at = now() WHERE id = @Id",
            new { S = confirm ? "confirmed_in_bank" : "rejected", N = input.Note.Trim(), U = access.UserId, Id = id }, tx);
        if (p.T is { } txId)
            await conn.ExecuteAsync(
                "UPDATE transactions SET payment_status = @Ps, notes = left(coalesce(notes || ' ', '') || @Note, 1000), updated_at = now() WHERE id = @T AND business_id = @B AND payment_status = 'awaiting_confirmation'",
                new { Ps = confirm ? PaymentStatuses.RecordedManually : PaymentStatuses.Failed, Note = confirm ? "Money seen in bank account: " + input.Note.Trim() : "Proof rejected: " + input.Note.Trim(), T = txId, B = access.BusinessId }, tx);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, confirm ? "payment_proof_confirmed_in_bank" : "payment_proof_rejected", "payment_proof", id);
        await JobQueue.EnqueueGrowthRefreshAsync(conn, tx, access.BusinessId);
        tx.Commit();
        return ToDto((await conn.QuerySingleAsync<Row>($"{Select} WHERE p.id = @Id", new { Id = id })));
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}

public sealed record SupplierBankDetailDto(Guid Id, string BankName, string AccountHolder, string AccountMasked, string Status, string ChangeSource,
    string? VerificationMethod, string? VerificationNote, DateTimeOffset? VerifiedAt, DateTimeOffset CreatedAt, bool SameAsVerified);

public sealed record SupplierBankInput(string? BankName, string? AccountHolder, string? AccountNumber, string? ChangeSource);

public sealed record VerifyBankInput(string? Method, string? Note);

/// <summary>Supplier bank details with independent verification. Only the last four digits and a keyed fingerprint are
/// stored. KasiFlow never pays suppliers.</summary>
public sealed class SupplierBankService(IDbConnectionFactory db, IBusinessContext business, IConfiguration config, ILogger<SupplierBankService> logger)
{
    public static readonly string[] Methods = ["called_known_number", "in_person", "bank_confirmation_letter", "other"];
    public static readonly string[] Sources = ["owner_entry", "supplier_message", "invoice", "other"];

    private byte[] Key(Guid businessId)
    {
        var secret = config["Security:FingerprintKey"];
        if (string.IsNullOrWhiteSpace(secret) || secret.Length < 32)
        {
            logger.LogWarning("Security:FingerprintKey is not set; deriving the fingerprint key from the database connection string.");
            secret = "kasiflow-fp:" + (config["Database:ConnectionString"] ?? "");
        }
        return HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), businessId.ToByteArray());
    }

    private sealed class Row
    {
        public Guid Id { get; set; }
        public string BankName { get; set; } = "";
        public string AccountHolder { get; set; } = "";
        public string AccountLast4 { get; set; } = "";
        public string AccountFingerprint { get; set; } = "";
        public string Status { get; set; } = "";
        public string ChangeSource { get; set; } = "";
        public string? VerificationMethod { get; set; }
        public string? VerificationNote { get; set; }
        public DateTime? VerifiedAt { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    private const string Cols = "id, bank_name, account_holder, account_last4, account_fingerprint, status, change_source, verification_method, verification_note, verified_at, created_at";

    private async Task<IReadOnlyList<SupplierBankDetailDto>> ListInternalAsync(IDbConnection conn, Guid businessId, Guid supplierId)
    {
        var rows = (await conn.QueryAsync<Row>($"SELECT {Cols} FROM supplier_bank_details WHERE business_id = @B AND supplier_id = @S ORDER BY created_at DESC",
            new { B = businessId, S = supplierId })).ToList();
        var verified = rows.FirstOrDefault(r => r.Status == "verified")?.AccountFingerprint;
        return rows.Select(r => new SupplierBankDetailDto(r.Id, r.BankName, r.AccountHolder, "•••• " + r.AccountLast4, r.Status, r.ChangeSource, r.VerificationMethod,
            r.VerificationNote, Barbershop.TeamRepository.Utc(r.VerifiedAt), Barbershop.TeamRepository.Utc(r.CreatedAt), verified is not null && r.AccountFingerprint == verified)).ToList();
    }

    public async Task<IReadOnlyList<SupplierBankDetailDto>> ListAsync(Guid supplierId, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewFinancials);
        await using var conn = await db.OpenAsync(ct);
        await EnsureSupplierAsync(conn, access.BusinessId, supplierId);
        return await ListInternalAsync(conn, access.BusinessId, supplierId);
    }

    private static async Task<string> EnsureSupplierAsync(IDbConnection conn, Guid businessId, Guid supplierId) =>
        await conn.QueryFirstOrDefaultAsync<string>("SELECT name FROM suppliers WHERE id = @Id AND business_id = @B", new { Id = supplierId, B = businessId })
        ?? throw new NotFoundException("Supplier not found.");

    public async Task<IReadOnlyList<SupplierBankDetailDto>> AddAsync(Guid supplierId, SupplierBankInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageFinancials);
        var e = new ValidationErrors();
        e.Required("bankName", input.BankName, 2, 60);
        e.Required("accountHolder", input.AccountHolder, 2, 120);
        var digits = new string((input.AccountNumber ?? "").Where(char.IsDigit).ToArray());
        if (digits.Length is < 6 or > 20) e.Add("accountNumber", "Enter the account number (6–20 digits). Only the last four digits are stored.");
        if (input.ChangeSource is not null && !Sources.Contains(input.ChangeSource)) e.Add("changeSource", "Choose where the details came from.");
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        var name = await EnsureSupplierAsync(conn, access.BusinessId, supplierId);
        var fp = Convert.ToHexString(HMACSHA256.HashData(Key(access.BusinessId), Encoding.UTF8.GetBytes(digits))).ToLowerInvariant();
        using var tx = conn.BeginTransaction();
        var verifiedFp = await conn.QueryFirstOrDefaultAsync<string>(
            "SELECT account_fingerprint FROM supplier_bank_details WHERE business_id = @B AND supplier_id = @S AND status = 'verified' ORDER BY verified_at DESC LIMIT 1",
            new { B = access.BusinessId, S = supplierId }, tx);
        if (verifiedFp == fp) throw new ConflictException("These are the same details that are already verified. Nothing changed.");
        var id = await conn.QuerySingleAsync<Guid>(
            """
            INSERT INTO supplier_bank_details (business_id, supplier_id, bank_name, account_holder, account_last4, account_fingerprint, change_source, created_by)
            VALUES (@B, @S, @Bank, @Holder, @Last4, @Fp, @Src, @U) RETURNING id
            """, new { B = access.BusinessId, S = supplierId, Bank = input.BankName!.Trim(), Holder = input.AccountHolder!.Trim(), Last4 = digits[^4..], Fp = fp,
                Src = input.ChangeSource ?? "owner_entry", U = access.UserId }, tx);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "supplier_bank_details_added", "supplier", supplierId,
            JsonSerializer.Serialize(new { changesVerified = verifiedFp is not null }));
        if (verifiedFp is not null)
            await NotificationRepository.NotifyAsync(conn, tx, access.BusinessId, Permission.VerifySupplierBankDetails, "alert", "critical",
                $"{name}: bank details changed", "Do not pay the new account until you have confirmed the change with the supplier on a number you already had.",
                "/alerts", $"bank:{id}");
        await JobQueue.EnqueueGrowthRefreshAsync(conn, tx, access.BusinessId);
        tx.Commit();
        return await ListInternalAsync(conn, access.BusinessId, supplierId);
    }

    public async Task<IReadOnlyList<SupplierBankDetailDto>> DecideAsync(Guid supplierId, Guid id, bool verify, VerifyBankInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.VerifySupplierBankDetails);
        var e = new ValidationErrors();
        if (verify && (input.Method is null || !Methods.Contains(input.Method))) e.Add("method", "Say how you verified the details independently.");
        if (string.IsNullOrWhiteSpace(input.Note) || input.Note.Length > 300) e.Add("note", "Write what you did (300 characters or fewer).");
        RequestValidationException.ThrowIfInvalid(e);
        await using var conn = await db.OpenAsync(ct);
        await EnsureSupplierAsync(conn, access.BusinessId, supplierId);
        using var tx = conn.BeginTransaction();
        var row = await conn.QueryFirstOrDefaultAsync<Row>($"SELECT {Cols} FROM supplier_bank_details WHERE id = @Id AND business_id = @B AND supplier_id = @S FOR UPDATE",
            new { Id = id, B = access.BusinessId, S = supplierId }, tx) ?? throw new NotFoundException();
        if (row.Status != "unverified") throw new ConflictException("These details were already decided.");
        if (verify)
            await conn.ExecuteAsync("UPDATE supplier_bank_details SET status = 'superseded' WHERE business_id = @B AND supplier_id = @S AND status = 'verified'",
                new { B = access.BusinessId, S = supplierId }, tx);
        await conn.ExecuteAsync(
            "UPDATE supplier_bank_details SET status = @St, verification_method = @M, verification_note = @N, verified_by = @U, verified_at = now() WHERE id = @Id",
            new { St = verify ? "verified" : "rejected", M = verify ? input.Method : null, N = input.Note!.Trim(), U = access.UserId, Id = id }, tx);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, verify ? "supplier_bank_details_verified" : "supplier_bank_details_rejected", "supplier", supplierId,
            JsonSerializer.Serialize(new { method = input.Method }));
        await JobQueue.EnqueueGrowthRefreshAsync(conn, tx, access.BusinessId);
        tx.Commit();
        return await ListInternalAsync(conn, access.BusinessId, supplierId);
    }
}
