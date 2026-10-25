namespace KasiFlow.Core.Inventory;

public static class MovementTypes
{
    public const string Received = "received";
    public const string Sold = "sold";
    public const string Adjustment = "adjustment";
    public const string Return = "return";       // customer return back into stock
    public const string Damaged = "damaged";
    public const string TransferOut = "transfer_out";
    public const string TransferIn = "transfer_in";
    public const string SaleReversal = "sale_reversal";
    public static readonly IReadOnlySet<string> All = new HashSet<string> { Received, Sold, Adjustment, Return, Damaged, TransferOut, TransferIn, SaleReversal };
    public static readonly IReadOnlySet<string> NeedApproval = new HashSet<string> { Adjustment, Damaged, Return };
}

public sealed record ReorderInput(
    Guid ProductId, string Name, int OnHand, int MinStock, int? LeadTimeDays,
    int UnitsSoldInWindow, int WindowDays, int SafetyDays, int CoverDays, int DefaultLeadTimeDays);

public sealed record ReorderSuggestion(
    Guid ProductId, string Name, int OnHand, int MinStock, decimal AverageDailySales, int LeadTimeDays,
    int ReorderPoint, int SuggestedQuantity, bool IsLowStock, bool InsufficientHistory, IReadOnlyList<string> Assumptions);

/// <summary>Deterministic reorder suggestions from recorded sales. Shows every assumption it used.</summary>
public static class ReorderCalculator
{
    public static ReorderSuggestion Calculate(ReorderInput i)
    {
        if (i.WindowDays <= 0) throw new ArgumentOutOfRangeException(nameof(i));
        var lead = i.LeadTimeDays ?? i.DefaultLeadTimeDays;
        var avg = Math.Round((decimal)i.UnitsSoldInWindow / i.WindowDays, 2, MidpointRounding.AwayFromZero);
        var insufficient = i.UnitsSoldInWindow == 0;
        var demandPoint = (int)Math.Ceiling(avg * (lead + i.SafetyDays));
        var reorderPoint = Math.Max(i.MinStock, demandPoint);
        var target = reorderPoint + (int)Math.Ceiling(avg * i.CoverDays);
        var low = i.OnHand <= reorderPoint && (reorderPoint > 0);
        var suggested = low ? Math.Max(0, Math.Max(target, i.MinStock * 2) - i.OnHand) : 0;

        var assumptions = new List<string>
        {
            $"Average sales: {avg} per day over the last {i.WindowDays} days ({i.UnitsSoldInWindow} units recorded).",
            $"Supplier lead time: {lead} day{(lead == 1 ? "" : "s")}{(i.LeadTimeDays is null ? " (default — set it on the product for accuracy)" : "")}.",
            $"Safety buffer: {i.SafetyDays} extra days of sales; order covers {i.CoverDays} days after arrival.",
            $"Reorder point = max(minimum stock {i.MinStock}, average × (lead time + safety buffer)) = {reorderPoint}.",
        };
        if (insufficient)
            assumptions.Add("No recorded sales in the window, so the suggestion only uses your minimum stock level.");
        return new ReorderSuggestion(i.ProductId, i.Name, i.OnHand, i.MinStock, avg, lead, reorderPoint, suggested, low, insufficient, assumptions);
    }
}
