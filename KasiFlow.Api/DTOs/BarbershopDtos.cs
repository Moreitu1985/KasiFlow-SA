namespace KasiFlow.Api.DTOs;

// ---- Team, status and schedules ----

public sealed record StaffStatusDto(string Status, string Label, string? Note, DateTimeOffset UpdatedAt, DateTimeOffset? ExpiresAt,
    bool Expired, bool Stale, string? Explanation, bool AvailableNow, bool BlocksNewBookings);

public sealed record WorkingHoursDto(int Weekday, string Start, string End);

public sealed record TimeOffDto(Guid Id, DateTimeOffset StartsAt, DateTimeOffset EndsAt, string Kind, string? Note);

public sealed record StaffServiceDto(Guid ServiceId, string ServiceName, long PriceCents, bool HasOwnPrice);

public sealed record StaffProfileDto(Guid Id, string DisplayName, string RoleTitle, Guid? BranchId, Guid? UserId, bool IsBookable,
    bool AcceptsHouseCalls, bool IsActive, bool IsYou, StaffStatusDto Status, IReadOnlyList<WorkingHoursDto> Hours,
    IReadOnlyList<StaffServiceDto> Services, int BookingsToday, string? Bio = null, string? Specialties = null, string? ContactPhone = null,
    string? EmergencyContactName = null, string? EmergencyContactPhone = null, bool HasLogin = false, int PhotoCount = 0, PendingLoginDto? PendingLogin = null);

/// <summary>A login invitation that has been created for this profile but not yet accepted.</summary>
public sealed record PendingLoginDto(string Email, DateTimeOffset ExpiresAt);

public sealed record StaffProfileInput(string? DisplayName, string? RoleTitle, Guid? BranchId, Guid? UserId, bool? IsBookable,
    bool? AcceptsHouseCalls, bool? IsActive, string? Bio = null, string? Specialties = null, string? ContactPhone = null,
    string? EmergencyContactName = null, string? EmergencyContactPhone = null);

/// <summary>Owner-side "Register a barber": profile, services, default hours and (optionally) a login invitation.</summary>
public sealed record RegisterBarberInput(string? DisplayName, string? RoleTitle, Guid? BranchId, bool? AcceptsHouseCalls, string? Bio,
    string? Specialties, string? ContactPhone, string? EmergencyContactName, string? EmergencyContactPhone, IReadOnlyList<StaffServiceInput>? Services,
    IReadOnlyList<WorkingHoursDto>? Hours, string? LoginEmail);

public sealed record LoginInviteInput(string? Email);

public sealed record RegisterBarberResultDto(StaffProfileDto Profile, string? InviteToken, string? InvitePath, string? InviteMessage);

public sealed record PortfolioPhotoDto(Guid Id, Guid StaffId, Guid? ServiceId, string? ServiceName, string? Caption, string ContentType, int SizeBytes,
    bool IsPublic, DateTimeOffset CreatedAt, string Url);

public sealed record PortfolioUpdateInput(string? Caption, bool? IsPublic, Guid? ServiceId);

public sealed record StatusInput(string? Status, string? Note, int? ForMinutes, string? RevertTo);

public sealed record StatusHistoryDto(string Status, string Label, string? Note, string Source, DateTimeOffset At, DateTimeOffset? ExpiresAt);

public sealed record TimeOffInput(DateTimeOffset? StartsAt, DateTimeOffset? EndsAt, string? Kind, string? Note);

public sealed record StaffServiceInput(Guid ServiceId, long? PriceCents);

public sealed record WorkspaceDto(StaffProfileDto? Profile, IReadOnlyList<BookingSummaryDto> Today, IReadOnlyList<BookingSummaryDto> Upcoming,
    IReadOnlyList<TimeOffDto> TimeOff, IReadOnlyList<StaffProfileDto> Team, string? Hint);

// ---- Services ----

public sealed record ServiceDto(Guid Id, string Name, string? Description, string? Category, long PriceCents, int DurationMinutes,
    bool IsActive, bool IsPublic, bool AllowsHouseCall, int SortOrder);

public sealed record ServiceInput(string? Name, string? Description, string? Category, long? PriceCents, int? DurationMinutes,
    bool? IsActive, bool? IsPublic, bool? AllowsHouseCall, int? SortOrder);

// ---- Bookings ----

public sealed record BookingItemInput(Guid ServiceId, string? PersonLabel);

public sealed record HouseCallInput(string? AddressLine, string? Suburb, string? Town, string? AccessNotes, decimal? Latitude,
    decimal? Longitude, decimal? DistanceKm);

public sealed record BookingInput(Guid? StaffId, DateTimeOffset? StartsAt, IReadOnlyList<BookingItemInput>? Items, string? LocationType,
    HouseCallInput? HouseCall, string? CustomerName, string? CustomerPhone, string? CustomerEmail, Guid? CustomerId, string? CustomerNote,
    string? InternalNote, long? DiscountCents, bool Confirm = false, bool OffDutyOverride = false, string? OverrideReason = null);

public sealed record BookingSummaryDto(Guid Id, string Reference, string Status, string StatusLabel, DateTimeOffset StartsAt,
    DateTimeOffset EndsAt, Guid? StaffId, string? StaffName, string CustomerName, string LocationType, int PeopleCount,
    long TotalCents, long PaidCents, string ServicesSummary, DateTimeOffset? ProposedStartsAt, string? ProposedBy);

public sealed record BookingItemDto(Guid Id, Guid? ServiceId, string ServiceName, string PersonLabel, long UnitPriceCents, int DurationMinutes);

public sealed record BookingEventDto(string Event, string? FromStatus, string? ToStatus, string ActorKind, string? Note, DateTimeOffset At);

public sealed record HouseCallDto(string? AddressLine, string? Suburb, string? Town, string? AccessNotes, decimal? Latitude, decimal? Longitude,
    decimal? DistanceKm, string DistanceSource, string DistanceLabel, long? EstimatedTravelCostCents, long? EstimatedOtherCostCents,
    bool AddressVisible, HouseCallEconomicsDto? Economics);

public sealed record HouseCallEconomicsDto(long RevenueCents, long? EstimatedCostsCents, long ActualCostsCents, long? EstimatedContributionCents,
    long ActualContributionCents, bool HasActualCosts, string Caveat);

public sealed record BookingPaymentDto(Guid TransactionId, long AmountCents, string PaymentMethod, string PaymentStatus, DateOnly Date);

public sealed record BookingDetailDto(BookingSummaryDto Summary, string? CustomerPhone, string? CustomerEmail, Guid? CustomerId,
    string? CustomerNote, string? InternalNote, long ServicesTotalCents, long TravelFeeCents, long DiscountCents,
    long? ProposedTravelFeeCents, DateTimeOffset? ProposedEndsAt, Guid? ProposedStaffId, string? ProposalNote, string Source,
    bool OffDutyOverride, string? OverrideReason, string? CancelReason, IReadOnlyList<BookingItemDto> Items,
    IReadOnlyList<BookingEventDto> Events, IReadOnlyList<BookingPaymentDto> Payments, HouseCallDto? HouseCall,
    IReadOnlyList<Guid> DebtIds, IReadOnlyList<string> AllowedActions, Guid? CustomerAccountId = null, string? VerifiedContact = null);

public sealed record ConfirmInput(bool OffDutyOverride = false, string? OverrideReason = null);

public sealed record ProposeInput(DateTimeOffset? StartsAt, Guid? StaffId, long? TravelFeeCents, string? Note);


public sealed record CompletionPaymentInput(long AmountCents, string? PaymentMethod);

public sealed record CompleteInput(IReadOnlyList<CompletionPaymentInput>? Payments, bool CreateDebtForRemainder = false, DateOnly? DebtDueDate = null,
    bool ChargeTermsDisclosed = false, string? Note = null);

public sealed record HouseCallUpdateInput(decimal? DistanceKm, long? EstimatedTravelCostCents, long? EstimatedOtherCostCents, string? AccessNotes);

public sealed record VisitExpenseInput(string? Category, long? AmountCents, string? Description, DateOnly? Date, string? PaymentMethod);

public sealed record SlotDto(DateTimeOffset StartsAt, DateTimeOffset EndsAt, Guid StaffId, string StaffName);

public sealed record AvailabilityDto(DateOnly Date, int DurationMinutes, IReadOnlyList<SlotDto> Slots, IReadOnlyList<string> Notes);

public sealed record QuoteDto(long ServicesTotalCents, long TravelFeeCents, long DiscountCents, long TotalCents, int DurationMinutes,
    bool TravelFeeFinal, string? TravelFeeExplanation, bool OutsideServiceArea);

// ---- Public booking ----

public sealed record PublicStaffDto(Guid Id, string DisplayName, string RoleTitle, string StatusLabel, bool AvailableNow, bool AcceptsHouseCalls,
    string? Bio = null, string? Specialties = null, IReadOnlyList<PublicStaffPriceDto>? Prices = null, IReadOnlyList<PublicPhotoDto>? Photos = null);

public sealed record PublicStaffPriceDto(Guid ServiceId, long PriceCents);

public sealed record PublicPhotoDto(Guid Id, string? Caption, Guid? ServiceId, string Url);

public sealed record PublicServiceDto(Guid Id, string Name, string? Description, string? Category, long PriceCents, int DurationMinutes, bool AllowsHouseCall);

public sealed record PublicBookingInfoDto(string Slug, string BusinessName, IReadOnlyList<PublicServiceDto> Services, IReadOnlyList<PublicStaffDto> Staff,
    bool HouseCallsEnabled, string TravelFeePolicy, bool RequiresConfirmation, int HorizonDays, string Disclaimer,
    bool SignInRequired = true, bool HouseCallsNeedAccount = true, string? HouseCallTerms = null);

public sealed record PublicBookingInput(Guid? StaffId, DateTimeOffset? StartsAt, IReadOnlyList<BookingItemInput>? Items, string? LocationType,
    HouseCallInput? HouseCall, string? CustomerName, string? CustomerPhone, string? CustomerEmail, string? CustomerNote);

public sealed record PublicBookingCreatedDto(string Reference, string Token, string StatusPath, PublicBookingStatusDto Booking);

public sealed record PublicBookingStatusDto(string Reference, string BusinessName, string Status, string StatusLabel, DateTimeOffset StartsAt,
    DateTimeOffset EndsAt, string? StaffName, string LocationType, IReadOnlyList<string> Services, long ServicesTotalCents, long TravelFeeCents,
    long TotalCents, DateTimeOffset? ProposedStartsAt, long? ProposedTravelFeeCents, string? ProposedBy, string? ProposalNote,
    IReadOnlyList<string> AllowedActions, string Message, IReadOnlyList<Guid>? ServiceIds = null, Guid? StaffId = null);

public sealed record PublicActionInput(string? Token, DateTimeOffset? StartsAt, string? Note);

// ---- Customer accounts (one-time-code sign-in) ----

public sealed record CustomerAccountDto(string VerifiedContact, string VerifiedChannel, string? FullName, string? ContactPhone, string? AddressLine,
    string? Suburb, string? Town, string? AccessNotes, bool HouseCallTermsAccepted, string HouseCallTerms, bool HouseCallReady,
    IReadOnlyList<string> MissingForHouseCall, DateTimeOffset MemberSince, ExperienceDto? Experience = null);

/// <param name="AcceptHouseCallTerms">true = agree to the current terms; false = withdraw; null = leave unchanged.</param>
public sealed record CustomerAccountInput(string? FullName, string? ContactPhone, string? AddressLine, string? Suburb, string? Town,
    string? AccessNotes, bool? AcceptHouseCallTerms);

public sealed record CustomerBookingDto(string Reference, string BusinessName, string? Slug, string Status, string StatusLabel, DateTimeOffset StartsAt,
    DateTimeOffset EndsAt, string? StaffName, string LocationType, string ServicesSummary, long TotalCents, bool NeedsYourAnswer);

// ---- House-call safety and customer safety notes (business side) ----

public sealed record SafetyCheckinInput(string? Kind, string? Note, decimal? Latitude, decimal? Longitude, int? AccuracyM);

public sealed record SafetyCheckinDto(Guid Id, string Kind, string Label, DateTimeOffset At, string? Note, decimal? Latitude, decimal? Longitude,
    int? AccuracyM, string? MapUrl, string ByName);

public sealed record SafetyNoteDto(Guid Id, string Category, string Note, string AuthorName, DateTimeOffset At, string? BookingReference);

public sealed record SafetyNoteInput(string? Category, string? Note);

public sealed record CustomerAccountSummaryDto(Guid UserId, string? FullName, string? ContactPhone, string? VerifiedContact, DateTimeOffset? MemberSince,
    int VisitsWithUs, int NoShowsWithUs, int CancelledByCustomer, bool HouseCallsBlocked, string? BlockReason, IReadOnlyList<SafetyNoteDto> SafetyNotes,
    bool CanBlock);

public sealed record HouseCallSafetyDto(Guid BookingId, string Reference, string Stage, string StageLabel, bool HelpActive, bool Overdue,
    string? OverdueReason, DateTimeOffset? CheckBy, IReadOnlyList<string> NextActions, bool CanCheckIn, bool IsAssignedBarber,
    IReadOnlyList<SafetyCheckinDto> Timeline, string? BarberName, string? BarberPhone, string? EmergencyContact, CustomerAccountSummaryDto? Customer,
    string EmergencyAdvice, int GraceMinutes);
