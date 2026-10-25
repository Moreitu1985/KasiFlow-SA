using Dapper;
using KasiFlow.Api.Data;
using KasiFlow.Api.DTOs;
using KasiFlow.Core.Access;
using KasiFlow.Core.Bookings;
using KasiFlow.Core.Common;

namespace KasiFlow.Api.Services.Barbershop;

/// <summary>The barber's own workspace: status, today's and upcoming appointments, time off, and colleagues' status.</summary>
public sealed class WorkspaceService(IDbConnectionFactory db, IBusinessContext business, TeamService team, IClock clock)
{
    public async Task<WorkspaceDto> GetAsync(CancellationToken ct)
    {
        var access = await business.GetAccessAsync(ct);
        await using var conn = await db.OpenAsync(ct);
        var all = access.Can(Permission.ViewTeamStatus) || access.Can(Permission.ManageStaffSchedules) || access.Can(Permission.ManageBookings)
            ? await team.TeamAsync(conn, access) : [];
        var me = all.FirstOrDefault(s => s.IsYou);
        if (me is null)
        {
            var mineRow = await TeamRepository.ForUserAsync(conn, access.BusinessId, access.UserId);
            if (mineRow is not null)
            {
                var now = clock.UtcNow;
                var sch = (await TeamRepository.SchedulesAsync(conn, access.BusinessId, [mineRow], now.AddDays(-1), now.AddDays(1)))[mineRow.Id];
                me = new StaffProfileDto(mineRow.Id, mineRow.DisplayName, mineRow.RoleTitle, mineRow.BranchId, mineRow.UserId, mineRow.IsBookable,
                    mineRow.AcceptsHouseCalls, mineRow.IsActive, true, TeamRepository.StatusDto(sch, now), [], [], 0);
            }
        }
        if (me is null)
            return new WorkspaceDto(null, [], [], [], all,
                "Your login is not linked to a team profile yet. The owner can link it under Staff → Team profiles.");
        var rows = await conn.QueryAsync<BookingRow>(
            $"""
            {BookingEngine.Select}
            WHERE b.business_id = @B AND b.staff_id = @S AND b.status IN ('requested','confirmed','reschedule_proposed','completed','no_show')
              AND b.starts_at >= (date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg')
              AND b.starts_at < now() + interval '14 days'
            ORDER BY b.starts_at
            """, new { B = access.BusinessId, S = me.Id });
        var today = clock.Today;
        var list = rows.Select(BookingEngine.Summary).ToList();
        var todays = list.Where(b => DateOnly.FromDateTime(b.StartsAt.ToOffset(StaffAvailability.SaOffset).DateTime) == today).ToList();
        var upcoming = list.Where(b => DateOnly.FromDateTime(b.StartsAt.ToOffset(StaffAvailability.SaOffset).DateTime) > today && b.Status != BookingStatuses.Completed).ToList();
        var timeOff = (await conn.QueryAsync<TimeOffRow>(
            "SELECT id, staff_id, starts_at, ends_at, kind, note FROM staff_time_off WHERE business_id = @B AND staff_id = @S AND ends_at > now() ORDER BY starts_at LIMIT 20",
            new { B = access.BusinessId, S = me.Id }))
            .Select(t => new TimeOffDto(t.Id, TeamRepository.Utc(t.StartsAt), TeamRepository.Utc(t.EndsAt), t.Kind, t.Note)).ToList();
        return new WorkspaceDto(me, todays, upcoming, timeOff, all, null);
    }
}
