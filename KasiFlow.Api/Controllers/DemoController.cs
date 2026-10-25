using KasiFlow.Api.Configuration;
using KasiFlow.Api.Data;
using KasiFlow.Api.DTOs;
using KasiFlow.Api.Middleware;
using KasiFlow.Api.Repositories;
using KasiFlow.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace KasiFlow.Api.Controllers;

public sealed record DemoStatusDto(bool Enabled);

/// <summary>
/// One-click loading of the FICTIONAL demo business ("Thato's Barber Studio") for the signed-in user.
/// Disabled unless App:EnableDemoData is true. The demo is always created for the caller's own user id
/// (from the validated token), never for another account.
/// </summary>
[Route("api/demo")]
public sealed class DemoController(IOptions<AppOptions> options, IDbConnectionFactory db, ICurrentUser user,
    IBusinessRepository businesses, IWebHostEnvironment env) : ApiControllerBase
{
    [HttpGet]
    public DemoStatusDto Status() => new(options.Value.EnableDemoData);

    [HttpPost("load")]
    [EnableRateLimiting("exports")]
    public async Task<BusinessDto> Load(CancellationToken ct)
    {
        if (!options.Value.EnableDemoData)
            throw new NotFoundException("Demo data is not enabled on this server.");
        var folder = DatabaseCommands.FindDatabaseFolder(env.ContentRootPath)
                     ?? throw new InvalidOperationException("The database folder with the demo seed was not found.");
        var id = await DatabaseCommands.SeedDemoAsync(db, folder, user.UserId)
                 ?? throw new InvalidOperationException("The demo business could not be created.");
        await using (var conn = await db.OpenAsync(ct))
            await AuditRepository.WriteAsync(conn, null, id, user.UserId, "demo.loaded", "business", id);
        return (await businesses.GetForUserAsync(id, user.UserId, ct))!.ToDto();
    }
}
