using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dapper;

namespace KasiFlow.Api.Data;

/// <summary>
/// <c>dotnet run -- demo-users</c>: creates one login per kind of user for the FICTIONAL demo shop in YOUR Supabase project
/// (owner, business manager, receptionist, two barbers, two customers), seeds "Thato's Barber Studio" for the owner and
/// links everyone to it.
/// <list type="bullet">
/// <item>Needs the Supabase service-role / secret key, read from configuration key <c>Supabase:ServiceRoleKey</c>
/// (user-secrets or an environment variable). It is used only by this command, on your machine, and never sent to a browser.</item>
/// <item>Passwords are generated randomly on every run (existing demo logins get a new one). They are printed and written
/// to <c>demo-logins.local</c> in the repository root, which git ignores. No credentials are stored in source control.</item>
/// <item>All demo emails use the reserved example.com domain, so nothing is ever emailed to a real person.</item>
/// <item>Each run rebuilds the fictional demo shop so today's data is current (pass <c>--keep</c> to leave it). Only the
/// shop flagged <c>is_demo</c> and owned by the demo owner login is ever removed.</item>
/// </list>
/// </summary>
public static class DemoUsersCommand
{
    private sealed record DemoUser(string Key, string Email, string Name, string Kind, string? Role, string? StaffProfilePrefix, string What);

    private static readonly DemoUser[] Users =
    [
        new("owner", "thato.owner@example.com", "Thato (owner)", "member", "owner", "Thato", "Shop owner — everything, incl. money, debts, alerts and the R5 debt policy"),
        new("manager", "lindiwe.manager@example.com", "Lindiwe (manager)", "member", "branch_manager", null, "Business manager — bookings, team, schedules, alerts; no owner-only settings"),
        new("reception", "zanele.reception@example.com", "Zanele (reception)", "member", "cashier", null, "Cashier / receptionist — bookings, sales, debt payments; no reports or settings"),
        new("barber1", "ayanda.barber@example.com", "Ayanda (barber)", "member", "staff", "Ayanda", "Barber — own status, own bookings, today's house call with safety check-ins, My work photos"),
        new("barber2", "bongani.barber@example.com", "Bongani (barber)", "member", "staff", "Bongani", "Barber — own status and own bookings"),
        new("customer1", "nomsa.customer@example.com", "Nomsa R. (fictional)", "customer", null, null, "Customer — house-call ready account with today's house call (3 people)"),
        new("customer2", "kagiso.customer@example.com", "Kagiso P. (fictional)", "customer", null, null, "Customer — shop booking today; account not yet complete for house calls"),
    ];

    public static async Task<int> RunAsync(string[] args, IServiceProvider services, IConfiguration config, IHostEnvironment env, ILogger logger, string databaseFolder)
    {
        if (env.IsProduction() && !args.Contains("--allow-production"))
        {
            logger.LogError("Refusing to create demo logins in Production without --allow-production.");
            return 3;
        }
        var url = (config["Auth:SupabaseUrl"] ?? "").TrimEnd('/');
        var key = config["Supabase:ServiceRoleKey"];
        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(key))
        {
            logger.LogError("""
                Set these first (user-secrets, from the KasiFlow.Api folder):
                  dotnet user-secrets set "Auth:SupabaseUrl" "https://<project-ref>.supabase.co"
                  dotnet user-secrets set "Supabase:ServiceRoleKey" "<service_role key or sb_secret_... key>"
                The key is in Supabase → Project Settings → API Keys. Keep it secret: never put it in the web app or in git.
                """);
            return 2;
        }

        using var http = new HttpClient { BaseAddress = new Uri(url + "/auth/v1/"), Timeout = TimeSpan.FromSeconds(30) };
        http.DefaultRequestHeaders.Add("apikey", key);
        // Legacy service_role keys are JWTs and also go in Authorization; the newer sb_secret_ keys must not.
        if (key.StartsWith("eyJ", StringComparison.Ordinal)) http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", key);

        var db = services.GetRequiredService<IDbConnectionFactory>();
        var created = new List<(DemoUser User, Guid Id, string Password)>();
        foreach (var u in Users)
        {
            var password = NewPassword();
            var id = await UpsertAuthUserAsync(http, u, password);
            created.Add((u, id, password));
            logger.LogInformation("Login ready: {Email}", u.Email);
        }

        var ownerId = created.First(c => c.User.Key == "owner").Id;
        // Rebuild the fictional demo shop each run so "today" (bookings, walk-in queue, house call, statuses, forecast)
        // is always today. --keep leaves an existing demo shop as it is.
        if (!args.Contains("--keep"))
        {
            var removed = await DatabaseCommands.ResetDemoAsync(db, ownerId);
            if (removed > 0) logger.LogInformation("Rebuilding the demo shop with fresh data for today (use --keep to skip).");
        }
        var businessId = await DatabaseCommands.SeedDemoAsync(db, databaseFolder, ownerId)
                         ?? throw new InvalidOperationException("Could not find or create the demo business.");

        await using (var conn = await db.OpenAsync())
        {
            var branch = await conn.QuerySingleAsync<Guid>("SELECT id FROM branches WHERE business_id = @B ORDER BY created_at LIMIT 1", new { B = businessId });
            foreach (var (u, id, _) in created.Where(c => c.User.Kind == "member" && c.User.Role != "owner"))
            {
                await conn.ExecuteAsync(
                    """
                    INSERT INTO business_members (business_id, user_id, role, display_name, email, invited_by, is_active)
                    VALUES (@B, @U, @R, @Name, @E, @Owner, TRUE)
                    ON CONFLICT (business_id, user_id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name, email = EXCLUDED.email,
                        is_active = TRUE, updated_at = now()
                    """, new { B = businessId, U = id, R = u.Role, Name = u.Name, E = u.Email, Owner = ownerId });
                await conn.ExecuteAsync("INSERT INTO member_branches (business_id, user_id, branch_id) VALUES (@B, @U, @Br) ON CONFLICT DO NOTHING",
                    new { B = businessId, U = id, Br = branch });
                if (u.StaffProfilePrefix is { } prefix)
                {
                    await conn.ExecuteAsync("UPDATE staff_profiles SET user_id = NULL WHERE business_id = @B AND user_id = @U AND display_name NOT LIKE @P",
                        new { B = businessId, U = id, P = prefix + "%" });
                    await conn.ExecuteAsync("UPDATE staff_profiles SET user_id = @U, updated_at = now() WHERE business_id = @B AND display_name LIKE @P",
                        new { B = businessId, U = id, P = prefix + "%" });
                }
            }

            // Customers: Nomsa takes over the fictional account the seed created for today's house call; Kagiso gets today's shop booking.
            var nomsa = created.First(c => c.User.Key == "customer1");
            var oldNomsa = await conn.QueryFirstOrDefaultAsync<Guid?>(
                "SELECT customer_user_id FROM bookings WHERE business_id = @B AND customer_name LIKE 'Nomsa%' AND customer_user_id IS NOT NULL LIMIT 1", new { B = businessId });
            if (oldNomsa is { } old && old != nomsa.Id)
            {
                await conn.ExecuteAsync("DELETE FROM customer_accounts WHERE user_id = @New", new { New = nomsa.Id });
                await conn.ExecuteAsync("UPDATE customer_accounts SET user_id = @New, verified_email = @E WHERE user_id = @Old", new { New = nomsa.Id, Old = old, E = nomsa.User.Email });
                await conn.ExecuteAsync("UPDATE bookings SET customer_user_id = @New, verified_contact = @E, customer_email = @E WHERE customer_user_id = @Old", new { New = nomsa.Id, Old = old, E = nomsa.User.Email });
                await conn.ExecuteAsync("UPDATE customer_safety_notes SET customer_user_id = @New WHERE customer_user_id = @Old", new { New = nomsa.Id, Old = old });
            }
            var kagiso = created.First(c => c.User.Key == "customer2");
            await conn.ExecuteAsync(
                """
                INSERT INTO customer_accounts (user_id, full_name, verified_email) VALUES (@U, @Name, @E)
                ON CONFLICT (user_id) DO UPDATE SET verified_email = EXCLUDED.verified_email
                """, new { U = kagiso.Id, Name = kagiso.User.Name, E = kagiso.User.Email });
            await conn.ExecuteAsync(
                "UPDATE bookings SET customer_user_id = @U, verified_contact = @E, customer_email = @E WHERE business_id = @B AND customer_name LIKE 'Kagiso%'",
                new { U = kagiso.Id, E = kagiso.User.Email, B = businessId });

            await conn.ExecuteAsync("UPDATE public_profiles SET is_published = TRUE WHERE business_id = @B", new { B = businessId });
        }

        string slug;
        await using (var conn = await db.OpenAsync())
            slug = await conn.QueryFirstOrDefaultAsync<string>("SELECT slug FROM public_profiles WHERE business_id = @B", new { B = businessId }) ?? "";

        var web = string.IsNullOrWhiteSpace(config["App:PublicWebBaseUrl"]) ? "http://localhost:5173" : config["App:PublicWebBaseUrl"]!.TrimEnd('/');
        var sb = new StringBuilder();
        sb.AppendLine("KasiFlow SA — DEMO logins (fictional shop). Generated " + DateTimeOffset.Now.ToString("yyyy-MM-dd HH:mm"));
        sb.AppendLine("Keep this file private. It is git-ignored. Re-running `dotnet run -- demo-users` gives everyone a new password.");
        sb.AppendLine();
        sb.AppendLine($"Sign in at {web}/sign-in  (owner, manager, reception and barbers: choose the matching option, then email + password)");
        sb.AppendLine($"Customers: {web}/c/sign-in  (needs VITE_DEMO_PASSWORD_SIGNIN=true in kasiflow-web/.env.local, then 'Demo account? Sign in with a password')");
        if (slug.Length > 0) sb.AppendLine($"Public booking page: {web}/p/{slug}/book");
        sb.AppendLine();
        foreach (var (u, _, pw) in created)
        {
            sb.AppendLine($"{u.Name}");
            sb.AppendLine($"  email:    {u.Email}");
            sb.AppendLine($"  password: {pw}");
            sb.AppendLine($"  what:     {u.What}");
            sb.AppendLine();
        }
        var text = sb.ToString();
        var repoRoot = Directory.GetParent(databaseFolder)!.FullName;
        var file = Path.Combine(repoRoot, "demo-logins.local");
        await File.WriteAllTextAsync(file, text);
        Console.WriteLine();
        Console.WriteLine(text);
        Console.WriteLine($"Saved to {file}");
        return 0;
    }

    private static string NewPassword()
    {
        // Upper, lower, digit and a symbol so it passes Supabase password policies; no look-alike characters.
        const string upper = "ABCDEFGHJKLMNPQRSTUVWXYZ", lower = "abcdefghijkmnpqrstuvwxyz", digits = "23456789";
        string Pick(string set, int n) => new(Enumerable.Range(0, n).Select(_ => set[RandomNumberGenerator.GetInt32(set.Length)]).ToArray());
        return $"{Pick(upper, 1)}{Pick(lower, 4)}-{Pick(digits, 4)}-{Pick(upper, 1)}{Pick(lower, 3)}";
    }

    private static async Task<Guid> UpsertAuthUserAsync(HttpClient http, DemoUser u, string password)
    {
        var body = new { email = u.Email, password, email_confirm = true, user_metadata = new { full_name = u.Name, demo = true } };
        var res = await http.PostAsync("admin/users", Json(body));
        if (res.IsSuccessStatusCode) return await IdAsync(res);
        var text = await res.Content.ReadAsStringAsync();
        if (res.StatusCode is not (HttpStatusCode.UnprocessableEntity or HttpStatusCode.BadRequest or HttpStatusCode.Conflict) ||
            !(text.Contains("already", StringComparison.OrdinalIgnoreCase) || text.Contains("exists", StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException($"Supabase refused to create {u.Email}: {(int)res.StatusCode} {Trim(text)}. " +
                (res.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden ? "Check Supabase:ServiceRoleKey (it must be the service_role / secret key, not the anon key)." : ""));

        // Already exists: find it and give it a fresh password.
        var id = await FindAsync(http, u.Email) ?? throw new InvalidOperationException($"{u.Email} exists in Supabase but could not be found in the user list.");
        var upd = await http.PutAsync($"admin/users/{id}", Json(new { password, email_confirm = true }));
        if (!upd.IsSuccessStatusCode) throw new InvalidOperationException($"Could not reset the password for {u.Email}: {(int)upd.StatusCode} {Trim(await upd.Content.ReadAsStringAsync())}");
        return id;
    }

    private static async Task<Guid> IdAsync(HttpResponseMessage res)
    {
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        var root = doc.RootElement.TryGetProperty("user", out var user) ? user : doc.RootElement;
        return root.GetProperty("id").GetGuid();
    }

    private static async Task<Guid?> FindAsync(HttpClient http, string email)
    {
        for (var page = 1; page <= 50; page++)
        {
            using var doc = JsonDocument.Parse(await http.GetStringAsync($"admin/users?page={page}&per_page=200"));
            var users = doc.RootElement.TryGetProperty("users", out var list) ? list : doc.RootElement;
            var count = 0;
            foreach (var x in users.EnumerateArray())
            {
                count++;
                if (x.TryGetProperty("email", out var e) && string.Equals(e.GetString(), email, StringComparison.OrdinalIgnoreCase))
                    return x.GetProperty("id").GetGuid();
            }
            if (count < 200) break;
        }
        return null;
    }

    private static StringContent Json(object body) => new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private static string Trim(string s) => s.Length > 300 ? s[..300] : s;
}
