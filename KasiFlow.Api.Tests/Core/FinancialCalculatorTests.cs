using KasiFlow.Core.Common;
using KasiFlow.Core.Domain;
using KasiFlow.Core.Finance;
using static KasiFlow.Api.Tests.Core.TestData;

namespace KasiFlow.Api.Tests.Core;

public class FinancialCalculatorTests
{
    [Fact]
    public void Business_with_no_transactions_has_opening_balance_and_zero_results()
    {
        Assert.Equal(80_000, FinancialCalculator.CashBalance(80_000, Day(-10), [], Today));
        var s = FinancialCalculator.Summarise([], Periods.Resolve(Periods.ThisMonth, Today));
        Assert.Equal(0, s.IncomeCents);
        Assert.Equal(0, s.ExpensesCents);
        Assert.Equal(0, s.NetResultCents);
        Assert.Empty(s.CategoryBreakdown);
    }

    [Fact]
    public void Cash_balance_counts_only_posted_confirmed_cash_within_opening_window()
    {
        var entries = new[]
        {
            Income(100_000, -5),
            Expense(30_000, -3),
            Income(50_000, -20),                                                     // before opening date: already in opening balance
            Income(70_000, 2, status: TransactionStatuses.Scheduled),               // planned, not cash
            Income(40_000, -1, payment: PaymentStatuses.AwaitingConfirmation),       // not confirmed
            Expense(25_000, -2, status: TransactionStatuses.Voided),                 // voided
            Income(10_000, -1, payment: PaymentStatuses.Failed),                     // failed
            Income(5_000, -1, payment: PaymentStatuses.ConfirmedExternal),           // future verified provider status counts
        };
        Assert.Equal(20_000 + 100_000 - 30_000 + 5_000, FinancialCalculator.CashBalance(20_000, Day(-10), entries, Today));
        Assert.Equal(40_000, FinancialCalculator.AwaitingConfirmation(entries, Today));
    }

    [Fact]
    public void Without_opening_date_all_counted_transactions_up_to_today_are_included()
    {
        var entries = new[] { Income(10_000, -400), Expense(4_000, -1) };
        Assert.Equal(6_000, FinancialCalculator.CashBalance(0, null, entries, Today));
    }

    [Fact]
    public void Summary_category_breakdown_and_net_result()
    {
        var entries = new[]
        {
            Income(60_000, -2), Income(40_000, -1, "Services"),
            Expense(25_000, -1, "Rent"), Expense(25_000, -1, "Transport"),
            Income(99_999, -60), // outside period
        };
        var s = FinancialCalculator.Summarise(entries, new DateRange(Day(-30), Today, "x"));
        Assert.Equal(100_000, s.IncomeCents);
        Assert.Equal(50_000, s.ExpensesCents);
        Assert.Equal(50_000, s.NetResultCents);
        Assert.Equal(4, s.TransactionCount);
        var sales = Assert.Single(s.CategoryBreakdown, c => c.Category == "Sales");
        Assert.Equal(60.0m, sales.SharePercent);
    }

    [Fact]
    public void Income_received_before_expenses_gives_positive_running_cash()
    {
        var entries = new[] { Income(50_000, -3), Expense(20_000, -1) };
        Assert.Equal(30_000, FinancialCalculator.CashBalance(0, Day(-5), entries, Today));
        Assert.Equal(50_000, FinancialCalculator.CashBalance(0, Day(-5), entries, Day(-2)));
    }

    [Fact]
    public void Monthly_totals_cover_requested_months_including_empty_ones()
    {
        var entries = new[] { Income(10_000, 0), Expense(3_000, -40) };
        var m = FinancialCalculator.Monthly(entries, Today, 3);
        Assert.Equal(3, m.Count);
        Assert.Equal("2026-08", m[0].Month);
        Assert.Equal(3_000, m[1].ExpensesCents);
        Assert.Equal(10_000, m[2].IncomeCents);
    }

    [Theory]
    [InlineData(60_000L, 25_000L, 0L, 35_000L)]
    [InlineData(60_000L, 60_000L, 0L, 0L)]
    [InlineData(60_000L, 10_000L, 50_000L, 0L)]
    public void Remaining_balance(long original, long paid, long writtenOff, long expected) =>
        Assert.Equal(expected, BalanceMath.Remaining(original, paid, writtenOff));

    [Fact]
    public void Partial_payments_and_overpayment_checks()
    {
        Assert.Equal(PaymentCheck.Ok, BalanceMath.CheckPayment(35_000, 25_000));
        Assert.Equal(PaymentCheck.Ok, BalanceMath.CheckPayment(35_000, 35_000));
        Assert.Equal(PaymentCheck.ExceedsRemaining, BalanceMath.CheckPayment(35_000, 35_001));
        Assert.Equal(PaymentCheck.NotPositive, BalanceMath.CheckPayment(35_000, 0));
        Assert.Equal(PaymentCheck.NotPositive, BalanceMath.CheckPayment(35_000, -1));
        Assert.Equal(PaymentCheck.AlreadySettled, BalanceMath.CheckPayment(0, 100));
        Assert.Equal(ReceivableStatuses.Settled, BalanceMath.ReceivableStatusAfter(0, ReceivableStatuses.Open));
        Assert.Equal(ReceivableStatuses.Open, BalanceMath.ReceivableStatusAfter(1, ReceivableStatuses.Open));
        Assert.Equal(PayableStatuses.Paid, BalanceMath.PayableStatusAfter(0, PayableStatuses.Open));
        Assert.Equal(PayableStatuses.Cancelled, BalanceMath.PayableStatusAfter(0, PayableStatuses.Cancelled));
    }

    [Theory]
    [InlineData(150_000L, "R1,500.00")]
    [InlineData(-25_000L, "-R250.00")]
    [InlineData(5L, "R0.05")]
    [InlineData(123_456_789L, "R1,234,567.89")]
    [InlineData(0L, "R0.00")]
    public void Formats_south_african_rand(long cents, string expected) => Assert.Equal(expected, Money.FormatZar(cents));

    [Fact]
    public void Periods_resolve_relative_to_today()
    {
        var week = Periods.Resolve(Periods.ThisWeek, Today); // 16 Oct 2026 is a Friday
        Assert.Equal(new DateOnly(2026, 10, 12), week.From);
        var last = Periods.Resolve(Periods.LastMonth, Today);
        Assert.Equal(new DateOnly(2026, 9, 1), last.From);
        Assert.Equal(new DateOnly(2026, 9, 30), last.To);
        Assert.Throws<ArgumentException>(() => Periods.Resolve(Periods.Custom, Today, Today, Today.AddDays(-1)));
    }

    [Theory]
    [InlineData("Thato's Barber Studio", "thatos-barber-studio")]
    [InlineData("  Mama Joy's Spaza & Café!! ", "mama-joys-spaza-cafe")]
    [InlineData("A", "a-business")]
    public void Slug_from_name(string name, string slug)
    {
        Assert.Equal(slug, Slug.FromName(name));
        Assert.True(Slug.IsValid(slug));
    }

    [Theory]
    [InlineData("=SUM(A1:A9)", "'=SUM(A1:A9)")]
    [InlineData("say \"hi\"", "\"say \"\"hi\"\"\"")]
    [InlineData("+27 82", "'+27 82")]
    [InlineData("-250.00", "-250.00")]
    [InlineData("-cmd", "'-cmd")]
    [InlineData("a,b", "\"a,b\"")]
    public void Csv_escapes_and_neutralises_formulas(string input, string expected) =>
        Assert.Equal(expected, CsvBuilder.Escape(input));
}
