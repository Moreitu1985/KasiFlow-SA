using Dapper;

namespace KasiFlow.Api.Data;

/// <summary>
/// Command-line database tasks:
/// <code>dotnet run --project KasiFlow.Api -- migrate</code>
/// <code>dotnet run --project KasiFlow.Api -- seed-demo --user-id &lt;supabase-user-uuid&gt;</code>
/// Both read the connection string from configuration (environment variables / user-secrets).
/// </summary>
public static class DatabaseCommands
{
    public static bool IsCommand(string[] args) => args.Length > 0 && args[0] is "migrate" or "seed-demo" or "demo-users" or "demo-more";

    public static async Task<int> RunAsync(string[] args, IServiceProvider services, IHostEnvironment env, ILogger logger)
    {
        var db = services.GetRequiredService<IDbConnectionFactory>();
        var root = FindDatabaseFolder(env.ContentRootPath)
                   ?? throw new DirectoryNotFoundException("Could not find the 'database' folder. Run from the repository.");

        if (args[0] == "migrate")
        {
            var applied = await MigrateAsync(db, Path.Combine(root, "migrations"), logger);
            logger.LogInformation("Migrations complete. {Count} applied.", applied);
            return 0;
        }

        if (args[0] == "demo-users")
            return await DemoUsersCommand.RunAsync(args, services, services.GetRequiredService<IConfiguration>(), env, logger, root);

        if (args[0] == "demo-more")
        {
            if (env.IsProduction() && !args.Contains("--allow-production"))
            {
                logger.LogError("Refusing to add demo data in Production without --allow-production.");
                return 3;
            }
            var demo = await FindDemoBusinessAsync(db);
            if (demo is null)
            {
                logger.LogError("No demo shop found. Run `dotnet run -- demo-users` first.");
                return 2;
            }
            var added = await AddMoreDemoDataAsync(db, root, demo.Value);
            logger.LogInformation(added ? "Extra demo data added to {Name}." : "{Name} already has the extra demo data (rebuild with demo-users to start over).", DemoBusinessName);
            return 0;
        }

        var idx = Array.IndexOf(args, "--user-id");
        if (idx < 0 || idx + 1 >= args.Length || !Guid.TryParse(args[idx + 1], out var userId))
        {
            logger.LogError("Usage: seed-demo --user-id <uuid of an existing Supabase user>");
            return 2;
        }
        if (env.IsProduction() && !args.Contains("--allow-production"))
        {
            logger.LogError("Refusing to seed demo data in Production without --allow-production.");
            return 3;
        }
        await SeedDemoAsync(db, root, userId);
        logger.LogInformation("Demo business seeded for user {UserId}.", userId);
        return 0;
    }

    public const string DemoBusinessName = "Thato's Barber Studio";

    /// <summary>Runs database/seed/demo_seed.sql for one user. Idempotent: does nothing if that user already
    /// has the demo business. Returns the demo business id.</summary>
    public static async Task<Guid?> SeedDemoAsync(IDbConnectionFactory db, string databaseFolder, Guid userId)
    {
        var sql = await File.ReadAllTextAsync(Path.Combine(databaseFolder, "seed", "demo_seed.sql"));
        // The script uses the psql variable :'user_id'. The value is a Guid, so substitution is safe.
        sql = sql.Replace(":'user_id'", $"'{userId:D}'");
        await using var conn = await db.OpenAsync();
        await conn.ExecuteAsync(sql, commandTimeout: 120);
        var id = await conn.QueryFirstOrDefaultAsync<Guid?>(
            "SELECT b.id FROM businesses b JOIN business_members m ON m.business_id = b.id WHERE m.user_id = @UserId AND b.name = @Name ORDER BY b.created_at LIMIT 1",
            new { UserId = userId, Name = DemoBusinessName });
        // Let the background worker evaluate the Growth Engine, alerts and debt charges for the new demo straight away.
        if (id is { } b) await Repositories.JobQueue.EnqueueGrowthRefreshAsync(conn, null, b);
        return id;
    }

    /// <summary>
    /// Removes the FICTIONAL demo shop owned by <paramref name="ownerUserId"/> so it can be seeded again with fresh,
    /// today-relative data (today's bookings, queue, house call, statuses and the cash forecast). Only touches a business
    /// that is flagged <c>is_demo</c>, has the demo name and is owned by that user — never a real business.
    /// Returns how many demo shops were removed.
    /// </summary>
    public static async Task<int> ResetDemoAsync(IDbConnectionFactory db, Guid ownerUserId)
    {
        await using var conn = await db.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();
        var ids = (await conn.QueryAsync<Guid>(
            """
            SELECT b.id FROM businesses b JOIN business_members m ON m.business_id = b.id AND m.role = 'owner'
            WHERE b.is_demo = TRUE AND b.name = @Name AND m.user_id = @U
            """, new { Name = DemoBusinessName, U = ownerUserId }, tx)).ToArray();
        if (ids.Length == 0) { await tx.RollbackAsync(); return 0; }
        // Tables whose foreign keys do not cascade are cleared first, children before parents; the rest cascade.
        string[] steps =
        [
            "DELETE FROM payable_payments WHERE business_id = ANY(@Ids)",
            "DELETE FROM receivable_payments WHERE business_id = ANY(@Ids)",
            "DELETE FROM payables WHERE business_id = ANY(@Ids)",
            "DELETE FROM receivables WHERE business_id = ANY(@Ids)",
            "DELETE FROM bookings WHERE business_id = ANY(@Ids)",
            "DELETE FROM shifts WHERE branch_id IN (SELECT id FROM branches WHERE business_id = ANY(@Ids))",
            "DELETE FROM transactions WHERE business_id = ANY(@Ids)",
            "DELETE FROM customers WHERE business_id = ANY(@Ids)",
            "DELETE FROM suppliers WHERE business_id = ANY(@Ids)",
            "DELETE FROM businesses WHERE id = ANY(@Ids)",
        ];
        foreach (var sql in steps) await conn.ExecuteAsync(sql, new { Ids = ids }, tx, commandTimeout: 120);
        await tx.CommitAsync();
        return ids.Length;
    }

    /// <summary>The fictional demo shop to top up: the one with the most linked people (the demo-users shop), newest first.</summary>
    public static async Task<Guid?> FindDemoBusinessAsync(IDbConnectionFactory db)
    {
        await using var conn = await db.OpenAsync();
        return await conn.QueryFirstOrDefaultAsync<Guid?>(
            """
            SELECT b.id FROM businesses b
            WHERE b.is_demo = TRUE AND b.name = @Name
            ORDER BY (SELECT COUNT(*) FROM business_members m WHERE m.business_id = b.id AND m.is_active) DESC, b.created_at DESC
            LIMIT 1
            """, new { Name = DemoBusinessName });
    }

    /// <summary>Runs database/seed/demo_more.sql for one demo shop. Returns false when it was already loaded.</summary>
    public static async Task<bool> AddMoreDemoDataAsync(IDbConnectionFactory db, string databaseFolder, Guid businessId)
    {
        var sql = await File.ReadAllTextAsync(Path.Combine(databaseFolder, "seed", "demo_more.sql"));
        // The script uses the psql variable :'business_id'. The value is a Guid, so substitution is safe.
        sql = sql.Replace(":'business_id'", $"'{businessId:D}'");
        await using var conn = await db.OpenAsync();
        var before = await conn.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM bookings WHERE business_id = @B AND internal_note = 'Extra demo data'", new { B = businessId });
        if (before > 0) return false;
        await conn.ExecuteAsync(sql, commandTimeout: 300);
        await Repositories.JobQueue.EnqueueGrowthRefreshAsync(conn, null, businessId);
        return true;
    }

    public static async Task<int> MigrateAsync(IDbConnectionFactory db, string folder, ILogger logger)
    {
        await using var conn = await db.OpenAsync();
        await conn.ExecuteAsync("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
        var done = (await conn.QueryAsync<string>("SELECT version FROM schema_migrations")).ToHashSet(StringComparer.Ordinal);
        var applied = 0;
        foreach (var file in Directory.GetFiles(folder, "*.sql").OrderBy(f => f, StringComparer.Ordinal))
        {
            var version = Path.GetFileNameWithoutExtension(file);
            if (done.Contains(version)) continue;
            logger.LogInformation("Applying migration {Version}", version);
            // Each migration file manages its own BEGIN/COMMIT and records its version.
            await conn.ExecuteAsync(await File.ReadAllTextAsync(file), commandTimeout: 300);
            applied++;
        }
        return applied;
    }

    public static string? FindDatabaseFolder(string start)
    {
        for (var dir = new DirectoryInfo(start); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "database");
            if (Directory.Exists(Path.Combine(candidate, "migrations"))) return candidate;
        }
        return null;
    }
}
