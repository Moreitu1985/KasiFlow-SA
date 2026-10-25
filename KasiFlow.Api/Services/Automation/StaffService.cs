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
using KasiFlow.Core.Validation;

namespace KasiFlow.Api.Services.Automation;

/// <summary>Branches, staff, invitations, role changes and staff performance. All changes to people's access are audited.</summary>
public sealed class StaffService(IDbConnectionFactory db, IBusinessContext business, ICurrentUser user, IClock clock)
{
    public static readonly TimeSpan InvitationLifetime = TimeSpan.FromDays(7);

    // ------------------------------------------------------------------ branches

    private sealed class BranchRow
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = "";
        public string? Area { get; set; }
        public bool IsActive { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    private static BranchDto ToDto(BranchRow b) => new(b.Id, b.Name, b.Area, b.IsActive, b.CreatedAt);

    public async Task<IReadOnlyList<BranchDto>> BranchesAsync(CancellationToken ct)
    {
        var access = await business.GetAccessAsync(ct);
        await using var conn = await db.OpenAsync(ct);
        var rows = await conn.QueryAsync<BranchRow>("SELECT id, name, area, is_active, created_at FROM branches WHERE business_id = @B ORDER BY created_at", new { B = access.BusinessId });
        return rows.Where(b => access.CanSeeBranch(b.Id)).Select(ToDto).ToList();
    }

    private static ValidationErrors ValidateBranch(BranchInput i)
    {
        var e = new ValidationErrors();
        if (string.IsNullOrWhiteSpace(i.Name) || i.Name.Trim().Length > 80) e.Add("name", "Enter a branch name (80 characters or fewer).");
        if (i.Area is { Length: > 120 }) e.Add("area", "Use 120 characters or fewer.");
        return e;
    }

    public async Task<BranchDto> CreateBranchAsync(BranchInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(ValidateBranch(input));
        var access = await business.RequireAsync(Permission.ManageBranches);
        await using var conn = await db.OpenAsync(ct);
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM branches WHERE business_id = @B", new { B = access.BusinessId }) >= 25)
            throw new ConflictException("A business can have up to 25 branches.");
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM branches WHERE business_id = @B AND lower(name) = lower(@N)", new { B = access.BusinessId, N = input.Name!.Trim() }) > 0)
            throw new ConflictException("A branch with that name already exists.");
        var row = await conn.QuerySingleAsync<BranchRow>(
            "INSERT INTO branches (business_id, name, area) VALUES (@B, @N, @A) RETURNING id, name, area, is_active, created_at",
            new { B = access.BusinessId, N = input.Name!.Trim(), A = string.IsNullOrWhiteSpace(input.Area) ? null : input.Area.Trim() });
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "branch_created", "branch", row.Id);
        return ToDto(row);
    }

    public async Task<BranchDto> UpdateBranchAsync(Guid id, BranchInput input, CancellationToken ct)
    {
        RequestValidationException.ThrowIfInvalid(ValidateBranch(input));
        var access = await business.RequireAsync(Permission.ManageBranches);
        await using var conn = await db.OpenAsync(ct);
        if (input.IsActive == false &&
            await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM shifts WHERE branch_id = @Id AND business_id = @B AND status = 'open'", new { Id = id, B = access.BusinessId }) > 0)
            throw new ConflictException("Close the open shifts at this branch before closing it.");
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM branches WHERE business_id = @B AND lower(name) = lower(@N) AND id <> @Id", new { B = access.BusinessId, N = input.Name!.Trim(), Id = id }) > 0)
            throw new ConflictException("A branch with that name already exists.");
        var row = await conn.QueryFirstOrDefaultAsync<BranchRow>(
            "UPDATE branches SET name = @N, area = @A, is_active = COALESCE(@Active, is_active), updated_at = now() WHERE id = @Id AND business_id = @B RETURNING id, name, area, is_active, created_at",
            new { Id = id, B = access.BusinessId, N = input.Name!.Trim(), A = string.IsNullOrWhiteSpace(input.Area) ? null : input.Area.Trim(), Active = input.IsActive })
            ?? throw new NotFoundException();
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "branch_updated", "branch", id);
        return ToDto(row);
    }

    // ------------------------------------------------------------------ staff overview

    private sealed class MemberRow
    {
        public Guid UserId { get; set; }
        public string? DisplayName { get; set; }
        public string? Email { get; set; }
        public string Role { get; set; } = "";
        public bool IsActive { get; set; }
        public Guid[] BranchIds { get; set; } = [];
        public DateTime CreatedAt { get; set; }
    }

    internal sealed class InviteRow
    {
        public Guid Id { get; set; }
        public string Email { get; set; } = "";
        public string Role { get; set; } = "";
        public Guid[] BranchIds { get; set; } = [];
        public string Status { get; set; } = "";
        public DateTime ExpiresAt { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    private static InvitationDto ToDto(InviteRow i) => new(i.Id, i.Email, i.Role, i.BranchIds, i.Status, i.ExpiresAt, i.CreatedAt);

    public async Task<StaffOverviewDto> OverviewAsync(CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewStaff);
        await using var conn = await db.OpenAsync(ct);
        var members = (await conn.QueryAsync<MemberRow>(
            """
            SELECT m.user_id, m.display_name, m.email, m.role, m.is_active, m.created_at,
                   COALESCE(ARRAY(SELECT mb.branch_id FROM member_branches mb WHERE mb.business_id = m.business_id AND mb.user_id = m.user_id), '{}') AS branch_ids
            FROM business_members m WHERE m.business_id = @B ORDER BY m.created_at
            """, new { B = access.BusinessId })).ToList();
        // Branch managers see the people of their own branches only.
        if (!access.AllBranches)
            members = members.Where(m => m.UserId == access.UserId || m.BranchIds.Any(access.BranchIds.Contains)).ToList();
        var invites = access.Can(Permission.ManageStaff)
            ? (await conn.QueryAsync<InviteRow>(
                "SELECT id, email, role, branch_ids, CASE WHEN status = 'pending' AND expires_at < now() THEN 'expired' ELSE status END AS status, expires_at, created_at FROM staff_invitations WHERE business_id = @B AND status = 'pending' ORDER BY created_at DESC",
                new { B = access.BusinessId })).Select(ToDto).ToList()
            : [];
        var branches = (await conn.QueryAsync<BranchRow>("SELECT id, name, area, is_active, created_at FROM branches WHERE business_id = @B ORDER BY created_at", new { B = access.BusinessId }))
            .Where(b => access.CanSeeBranch(b.Id)).Select(ToDto).ToList();
        var roles = Roles.All.Select(r => new RoleInfoDto(r, Roles.Label(r), Roles.IsBranchScoped(r), RolePermissions.For(r))).ToList();
        return new StaffOverviewDto(
            members.Select(m => new StaffMemberDto(m.UserId, m.DisplayName, m.Email, m.Role, Roles.Label(m.Role), m.IsActive, m.BranchIds, m.CreatedAt, m.UserId == access.UserId)).ToList(),
            invites, branches, roles);
    }

    // ------------------------------------------------------------------ invitations

    public static string HashToken(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    private static async Task<Guid[]> ValidateBranchesAsync(IDbConnection conn, IDbTransaction? tx, Guid businessId, string role, IReadOnlyList<Guid>? branchIds, ValidationErrors e)
    {
        var ids = (branchIds ?? []).Distinct().ToArray();
        if (Roles.IsBranchScoped(role) && ids.Length == 0) e.Add("branchIds", "Choose at least one branch for this role.");
        if (!Roles.IsBranchScoped(role)) return [];
        if (ids.Length > 0 && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM branches WHERE business_id = @B AND is_active AND id = ANY(@Ids)", new { B = businessId, Ids = ids }, tx) != ids.Length)
            e.Add("branchIds", "Choose active branches of this business.");
        return ids;
    }

    public async Task<InvitationCreatedDto> InviteAsync(InvitationInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageStaff);
        var e = new ValidationErrors();
        var email = input.Email?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(email) || email.Length > 254 || !email.Contains('@') || email.StartsWith('@') || email.EndsWith('@'))
            e.Add("email", "Enter the person's email address.");
        var role = input.Role?.Trim() ?? "";
        if (!Roles.Assignable.Contains(role)) e.Add("role", "Choose a role. Ownership cannot be given through an invitation.");
        else if (role == Roles.BusinessAdmin && access.Role != Roles.Owner) e.Add("role", "Only the owner can invite a business administrator.");
        await using var conn = await db.OpenAsync(ct);
        var branchIds = Roles.Assignable.Contains(role) ? await ValidateBranchesAsync(conn, null, access.BusinessId, role, input.BranchIds, e) : [];
        RequestValidationException.ThrowIfInvalid(e);

        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM business_members WHERE business_id = @B AND lower(email) = @E AND is_active", new { B = access.BusinessId, E = email }) > 0)
            throw new ConflictException("That person is already a member of this business.");
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM staff_invitations WHERE business_id = @B AND status = 'pending' AND expires_at > now()", new { B = access.BusinessId }) >= 50)
            throw new ConflictException("Too many pending invitations. Revoke some first.");

        using var tx = conn.BeginTransaction();
        var (row, token) = await CreateInviteAsync(conn, tx, access.BusinessId, email!, role, branchIds, access.UserId, null, clock);
        tx.Commit();
        return new InvitationCreatedDto(ToDto(row), token, $"/join?token={token}", InviteMessage);
    }

    public const string InviteMessage =
        "Share this link with the person yourself (no email service is configured). It works once, only for this email address, and expires in 7 days.";

    /// <summary>Creates a one-time invitation (only its SHA-256 hash is stored). An earlier pending invitation for the same
    /// email is replaced. When <paramref name="staffProfileId"/> is set, accepting it links the login to that barber profile.</summary>
    internal static async Task<(InviteRow Row, string Token)> CreateInviteAsync(IDbConnection conn, IDbTransaction tx, Guid businessId, string email, string role,
        Guid[] branchIds, Guid invitedBy, Guid? staffProfileId, IClock clock)
    {
        await conn.ExecuteAsync("UPDATE staff_invitations SET status = 'revoked' WHERE business_id = @B AND lower(email) = @E AND status = 'pending'", new { B = businessId, E = email }, tx);
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var row = await conn.QuerySingleAsync<InviteRow>(
            """
            INSERT INTO staff_invitations (business_id, email, role, branch_ids, token_hash, expires_at, invited_by, staff_profile_id)
            VALUES (@B, @E, @R, @Branches, @Hash, @Expires, @U, @Profile)
            RETURNING id, email, role, branch_ids, status, expires_at, created_at
            """, new { B = businessId, E = email, R = role, Branches = branchIds, Hash = HashToken(token), Expires = clock.UtcNow.Add(InvitationLifetime).UtcDateTime,
                U = invitedBy, Profile = staffProfileId }, tx);
        await AuditRepository.WriteAsync(conn, tx, businessId, invitedBy, "staff_invited", "staff_invitation", row.Id, JsonSerializer.Serialize(new { role, staffProfileId }));
        return (row, token);
    }

    public async Task RevokeInvitationAsync(Guid id, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageStaff);
        await using var conn = await db.OpenAsync(ct);
        if (await conn.ExecuteAsync("UPDATE staff_invitations SET status = 'revoked' WHERE id = @Id AND business_id = @B AND status = 'pending'", new { Id = id, B = access.BusinessId }) == 0)
            throw new NotFoundException();
        await AuditRepository.WriteAsync(conn, null, access.BusinessId, access.UserId, "staff_invitation_revoked", "staff_invitation", id);
    }

    private sealed class PendingInvite
    {
        public Guid Id { get; set; }
        public Guid BusinessId { get; set; }
        public string Email { get; set; } = "";
        public string Role { get; set; } = "";
        public Guid[] BranchIds { get; set; } = [];
        public DateTime ExpiresAt { get; set; }
        public Guid InvitedBy { get; set; }
        public string BusinessName { get; set; } = "";
        public Guid? StaffProfileId { get; set; }
    }

    /// <summary>Accepts an invitation for the signed-in user. The account email must match the invited email.</summary>
    public async Task<BusinessSummaryForJoinDto> AcceptAsync(AcceptInvitationInput input, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(input.Token) || input.Token.Length > 100) throw new BadRequestException("This invitation link is not valid.");
        var userId = user.UserId;
        var email = user.Email?.Trim().ToLowerInvariant();
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var inv = await conn.QueryFirstOrDefaultAsync<PendingInvite>(
            """
            SELECT i.id, i.business_id, i.email, i.role, i.branch_ids, i.expires_at, i.invited_by, b.name AS business_name, i.staff_profile_id
            FROM staff_invitations i JOIN businesses b ON b.id = i.business_id
            WHERE i.token_hash = @Hash AND i.status = 'pending' FOR UPDATE OF i
            """, new { Hash = HashToken(input.Token.Trim()) }, tx);
        if (inv is null || inv.ExpiresAt < clock.UtcNow.UtcDateTime) throw new BadRequestException("This invitation link is not valid or has expired. Ask for a new one.");
        if (email is null || email != inv.Email.ToLowerInvariant())
            throw new ForbiddenException("This invitation was sent to a different email address. Sign in with the invited email.");
        // The person who sent the invitation must still be allowed to give this role.
        var inviterRole = await conn.QueryFirstOrDefaultAsync<string>(
            "SELECT role FROM business_members WHERE business_id = @B AND user_id = @U AND is_active", new { B = inv.BusinessId, U = inv.InvitedBy }, tx);
        if (inviterRole is null || !RolePermissions.Has(inviterRole, Permission.ManageStaff) || (inv.Role == Roles.BusinessAdmin && inviterRole != Roles.Owner))
            throw new BadRequestException("This invitation is no longer valid. Ask the business owner for a new one.");
        var existing = await conn.QueryFirstOrDefaultAsync<MemberRow>(
            "SELECT user_id, role, is_active, created_at FROM business_members WHERE business_id = @B AND user_id = @U", new { B = inv.BusinessId, U = userId }, tx);
        if (existing is { Role: Roles.Owner }) throw new ConflictException("You already own this business.");
        if (existing is { IsActive: true }) throw new ConflictException("You are already a member of this business.");

        await conn.ExecuteAsync(
            """
            INSERT INTO business_members (business_id, user_id, role, display_name, email, invited_by, is_active)
            VALUES (@B, @U, @R, @Name, @E, @By, TRUE)
            ON CONFLICT (business_id, user_id) DO UPDATE SET role = EXCLUDED.role, email = EXCLUDED.email, invited_by = EXCLUDED.invited_by, is_active = TRUE, updated_at = now()
            """, new { B = inv.BusinessId, U = userId, R = inv.Role, Name = email.Split('@')[0], E = email, By = inv.InvitedBy }, tx);
        await conn.ExecuteAsync("DELETE FROM member_branches WHERE business_id = @B AND user_id = @U", new { B = inv.BusinessId, U = userId }, tx);
        foreach (var b in inv.BranchIds)
            await conn.ExecuteAsync("INSERT INTO member_branches (business_id, user_id, branch_id) VALUES (@B, @U, @Br) ON CONFLICT DO NOTHING", new { B = inv.BusinessId, U = userId, Br = b }, tx);
        await conn.ExecuteAsync("UPDATE staff_invitations SET status = 'accepted', accepted_by = @U, accepted_at = now() WHERE id = @Id", new { Id = inv.Id, U = userId }, tx);
        // A barber registered by the owner: link this login to their profile so they see their own bookings and status.
        if (inv.StaffProfileId is { } profileId &&
            await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM staff_profiles WHERE business_id = @B AND user_id = @U", new { B = inv.BusinessId, U = userId }, tx) == 0)
            await conn.ExecuteAsync("UPDATE staff_profiles SET user_id = @U, updated_at = now() WHERE id = @Id AND business_id = @B AND user_id IS NULL",
                new { U = userId, Id = profileId, B = inv.BusinessId }, tx);
        await AuditRepository.WriteAsync(conn, tx, inv.BusinessId, userId, "staff_joined", "staff_invitation", inv.Id, JsonSerializer.Serialize(new { role = inv.Role }));
        await NotificationRepository.NotifyAsync(conn, tx, inv.BusinessId, Permission.ManageStaff, "staff", "informational",
            "A team member joined", $"{email} accepted the invitation as {Roles.Label(inv.Role)}.", "/staff", $"joined:{inv.Id}");
        tx.Commit();
        return new BusinessSummaryForJoinDto(inv.BusinessId, inv.BusinessName, inv.Role, Roles.Label(inv.Role));
    }

    // ------------------------------------------------------------------ role changes & deactivation

    public async Task<StaffMemberDto> ChangeRoleAsync(Guid targetUserId, RoleChangeInput input, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageStaff);
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var target = await conn.QueryFirstOrDefaultAsync<MemberRow>(
            "SELECT user_id, display_name, email, role, is_active, created_at FROM business_members WHERE business_id = @B AND user_id = @U FOR UPDATE",
            new { B = access.BusinessId, U = targetUserId }, tx) ?? throw new NotFoundException();
        var newRole = input.Role?.Trim() ?? "";
        var check = RolePermissions.CanChangeRole(access.Role, access.UserId, target.Role, targetUserId, newRole);
        switch (check)
        {
            case RoleChangeCheck.Ok: break;
            case RoleChangeCheck.RoleNotAssignable: throw new RequestValidationException(new ValidationErrors().Add("role", "Choose a role. Ownership cannot be assigned."));
            case RoleChangeCheck.CannotChangeOwnRole: throw new ForbiddenException("You cannot change your own role.");
            case RoleChangeCheck.CannotChangeOwner: throw new ForbiddenException("The owner's role cannot be changed.");
            case RoleChangeCheck.OnlyOwnerManagesAdmins: throw new ForbiddenException("Only the owner can manage business administrators.");
            default: throw new ForbiddenException("You do not have permission to change roles.");
        }
        var e = new ValidationErrors();
        var branchIds = await ValidateBranchesAsync(conn, tx, access.BusinessId, newRole, input.BranchIds, e);
        RequestValidationException.ThrowIfInvalid(e);

        await conn.ExecuteAsync("UPDATE business_members SET role = @R, updated_at = now() WHERE business_id = @B AND user_id = @U", new { R = newRole, B = access.BusinessId, U = targetUserId }, tx);
        await conn.ExecuteAsync("DELETE FROM member_branches WHERE business_id = @B AND user_id = @U", new { B = access.BusinessId, U = targetUserId }, tx);
        foreach (var b in branchIds)
            await conn.ExecuteAsync("INSERT INTO member_branches (business_id, user_id, branch_id) VALUES (@B, @U, @Br)", new { B = access.BusinessId, U = targetUserId, Br = b }, tx);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, "staff_role_changed", "business_member", targetUserId,
            JsonSerializer.Serialize(new { from = target.Role, to = newRole, branches = branchIds.Length }));
        tx.Commit();
        return new StaffMemberDto(targetUserId, target.DisplayName, target.Email, newRole, Roles.Label(newRole), target.IsActive, branchIds, target.CreatedAt, false);
    }

    public async Task SetActiveAsync(Guid targetUserId, bool active, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ManageStaff);
        if (targetUserId == access.UserId) throw new ForbiddenException("You cannot deactivate yourself.");
        await using var conn = await db.OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        var role = await conn.QueryFirstOrDefaultAsync<string>("SELECT role FROM business_members WHERE business_id = @B AND user_id = @U FOR UPDATE",
            new { B = access.BusinessId, U = targetUserId }, tx) ?? throw new NotFoundException();
        if (role == Roles.Owner) throw new ForbiddenException("The owner cannot be deactivated.");
        if (role == Roles.BusinessAdmin && access.Role != Roles.Owner) throw new ForbiddenException("Only the owner can manage business administrators.");
        if (!active && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM shifts WHERE business_id = @B AND staff_user_id = @U AND status = 'open'", new { B = access.BusinessId, U = targetUserId }, tx) > 0)
            throw new ConflictException("This person has an open shift. Close it first.");
        await conn.ExecuteAsync("UPDATE business_members SET is_active = @A, updated_at = now() WHERE business_id = @B AND user_id = @U", new { A = active, B = access.BusinessId, U = targetUserId }, tx);
        await AuditRepository.WriteAsync(conn, tx, access.BusinessId, access.UserId, active ? "staff_reactivated" : "staff_deactivated", "business_member", targetUserId);
        tx.Commit();
    }

    // ------------------------------------------------------------------ performance

    private sealed class PerfRow
    {
        public Guid UserId { get; set; }
        public string Name { get; set; } = "";
        public string Role { get; set; } = "";
        public int SalesCount { get; set; }
        public long SalesCents { get; set; }
        public int VoidedCount { get; set; }
        public int ShiftsClosed { get; set; }
        public int CashUpsNeedingReview { get; set; }
        public long NetCashVarianceCents { get; set; }
    }

    public async Task<StaffPerformanceDto> PerformanceAsync(DateOnly? from, DateOnly? to, CancellationToken ct)
    {
        var access = await business.RequireAsync(Permission.ViewBusinessInsights);
        var end = to ?? clock.Today;
        var start = from ?? end.AddDays(-29);
        if (end < start || end.DayNumber - start.DayNumber > 366)
            throw new RequestValidationException(new ValidationErrors().Add("to", "Choose a period of up to one year."));
        await using var conn = await db.OpenAsync(ct);
        var rows = (await conn.QueryAsync<PerfRow>(
            """
            SELECT m.user_id, COALESCE(m.display_name, m.email, 'Team member') AS name, m.role,
              (SELECT COUNT(*) FROM transactions t WHERE t.business_id = m.business_id AND t.created_by = m.user_id AND t.type = 'income' AND t.status = 'posted'
                  AND t.origin = 'staff_recorded' AND t.transaction_date BETWEEN @From AND @To AND (@Branches::uuid[] IS NULL OR t.branch_id = ANY(@Branches::uuid[])))::int AS sales_count,
              (SELECT COALESCE(SUM(t.amount_cents), 0) FROM transactions t WHERE t.business_id = m.business_id AND t.created_by = m.user_id AND t.type = 'income' AND t.status = 'posted'
                  AND t.origin = 'staff_recorded' AND t.transaction_date BETWEEN @From AND @To AND (@Branches::uuid[] IS NULL OR t.branch_id = ANY(@Branches::uuid[])))::bigint AS sales_cents,
              (SELECT COUNT(*) FROM transactions t WHERE t.business_id = m.business_id AND t.created_by = m.user_id AND t.status = 'voided'
                  AND t.transaction_date BETWEEN @From AND @To AND (@Branches::uuid[] IS NULL OR t.branch_id = ANY(@Branches::uuid[])))::int AS voided_count,
              (SELECT COUNT(*) FROM shifts s WHERE s.business_id = m.business_id AND s.staff_user_id = m.user_id AND s.status <> 'open'
                  AND (s.opened_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN @From AND @To AND (@Branches::uuid[] IS NULL OR s.branch_id = ANY(@Branches::uuid[])))::int AS shifts_closed,
              (SELECT COUNT(*) FROM shifts s WHERE s.business_id = m.business_id AND s.staff_user_id = m.user_id AND s.needs_review
                  AND (s.opened_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN @From AND @To AND (@Branches::uuid[] IS NULL OR s.branch_id = ANY(@Branches::uuid[])))::int AS cash_ups_needing_review,
              (SELECT COALESCE(SUM(s.variance_cents), 0) FROM shifts s WHERE s.business_id = m.business_id AND s.staff_user_id = m.user_id AND s.status <> 'open'
                  AND (s.opened_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN @From AND @To AND (@Branches::uuid[] IS NULL OR s.branch_id = ANY(@Branches::uuid[])))::bigint AS net_cash_variance_cents
            FROM business_members m
            WHERE m.business_id = @B AND m.is_active
              AND (@Branches::uuid[] IS NULL OR EXISTS (SELECT 1 FROM member_branches mb WHERE mb.business_id = m.business_id AND mb.user_id = m.user_id AND mb.branch_id = ANY(@Branches::uuid[])))
            ORDER BY sales_cents DESC
            """, new { B = access.BusinessId, From = start, To = end, Branches = access.BranchFilter })).ToList();
        return new StaffPerformanceDto(start, end,
            rows.Select(r => new StaffPerformanceRowDto(r.UserId, r.Name, Roles.Label(r.Role), r.SalesCount, r.SalesCents,
                r.SalesCount == 0 ? 0 : r.SalesCents / r.SalesCount, r.VoidedCount, r.ShiftsClosed, r.CashUpsNeedingReview, r.NetCashVarianceCents)).ToList(),
            [
                "Only sales recorded in KasiFlow by each person are counted. Sales from payment providers do not say which staff member served the customer.",
                "Differences in shifts worked, branch traffic, days of the week and the kind of work each person does affect these numbers.",
                "A cash-up difference is not proof of wrongdoing. Counting mistakes, unrecorded paid-outs and change errors are common causes.",
                "Use these figures to start a conversation, not to judge a person on their own.",
            ]);
    }
}
