using System.Data;
using System.Data.Common;
using Dapper;
using Npgsql;

namespace KasiFlow.Api.Data;

public interface IDbConnectionFactory
{
    Task<DbConnection> OpenAsync(CancellationToken ct = default);
}

public sealed class NpgsqlConnectionFactory(NpgsqlDataSource dataSource) : IDbConnectionFactory
{
    public async Task<DbConnection> OpenAsync(CancellationToken ct = default) =>
        await dataSource.OpenConnectionAsync(ct);
}

/// <summary>Dapper configuration: snake_case column mapping and DateOnly support.</summary>
public static class DapperSetup
{
    private static int _configured;

    public static void Configure()
    {
        if (Interlocked.Exchange(ref _configured, 1) == 1) return;
        DefaultTypeMap.MatchNamesWithUnderscores = true;
        SqlMapper.AddTypeHandler(new DateOnlyHandler());
    }

    private sealed class DateOnlyHandler : SqlMapper.TypeHandler<DateOnly>
    {
        public override void SetValue(IDbDataParameter parameter, DateOnly value)
        {
            parameter.DbType = DbType.Date;
            parameter.Value = value.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);
        }

        public override DateOnly Parse(object value) => value switch
        {
            DateOnly d => d,
            DateTime dt => DateOnly.FromDateTime(dt),
            string s => DateOnly.Parse(s, System.Globalization.CultureInfo.InvariantCulture),
            _ => throw new DataException($"Cannot convert {value.GetType()} to DateOnly")
        };
    }
}

public static class PostgresErrors
{
    public const string UniqueViolation = "23505";
    public const string ForeignKeyViolation = "23503";
    public const string CheckViolation = "23514";

    public static bool IsUniqueViolation(Exception ex, string? constraint = null) =>
        ex is PostgresException pg && pg.SqlState == UniqueViolation && (constraint is null || pg.ConstraintName == constraint);
}
