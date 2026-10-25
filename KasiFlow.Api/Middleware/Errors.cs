using KasiFlow.Core.Validation;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace KasiFlow.Api.Middleware;

/// <summary>Base type for expected, client-facing errors. Messages must never contain sensitive data.</summary>
public abstract class AppException(string message) : Exception(message)
{
    public abstract int StatusCode { get; }
    public virtual string Title => "Request failed";
}

public sealed class NotFoundException(string message = "The requested record was not found.") : AppException(message)
{
    public override int StatusCode => StatusCodes.Status404NotFound;
    public override string Title => "Not found";
}

public sealed class ForbiddenException(string message) : AppException(message)
{
    public override int StatusCode => StatusCodes.Status403Forbidden;
    public override string Title => "Not allowed";
}

public sealed class ConflictException(string message) : AppException(message)
{
    public override int StatusCode => StatusCodes.Status409Conflict;
    public override string Title => "Conflict";
}

public sealed class BadRequestException(string message) : AppException(message)
{
    public override int StatusCode => StatusCodes.Status400BadRequest;
    public override string Title => "Invalid request";
}

public sealed class RequestValidationException(ValidationErrors errors) : AppException("One or more validation errors occurred.")
{
    public ValidationErrors Errors { get; } = errors;
    public override int StatusCode => StatusCodes.Status400BadRequest;

    public static void ThrowIfInvalid(ValidationErrors errors)
    {
        if (!errors.IsValid) throw new RequestValidationException(errors);
    }
}

/// <summary>Turns exceptions into RFC 7807 problem details. Unexpected errors are logged (without request
/// bodies) and returned as a generic 500 with a trace id — never a stack trace.</summary>
public sealed class GlobalExceptionHandler(ILogger<GlobalExceptionHandler> logger, IProblemDetailsService problemDetails) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        ProblemDetails problem;
        switch (exception)
        {
            case RequestValidationException v:
                problem = new ValidationProblemDetails(v.Errors.ToDictionary().ToDictionary(k => k.Key, k => k.Value))
                {
                    Status = StatusCodes.Status400BadRequest,
                    Title = "One or more validation errors occurred."
                };
                break;
            case AppException app:
                problem = new ProblemDetails { Status = app.StatusCode, Title = app.Title, Detail = app.Message };
                break;
            case UnauthorizedAccessException:
                problem = new ProblemDetails { Status = StatusCodes.Status401Unauthorized, Title = "Unauthorized", Detail = "Sign in again to continue." };
                break;
            case BadHttpRequestException bad:
                problem = new ProblemDetails { Status = bad.StatusCode, Title = "Invalid request", Detail = "The request could not be read." };
                break;
            case OperationCanceledException when httpContext.RequestAborted.IsCancellationRequested:
                problem = new ProblemDetails { Status = 499, Title = "Request cancelled" };
                break;
            default:
                // Log type and message only: no request body, no SQL parameters, no amounts.
                logger.LogError(exception, "Unhandled exception for {Method} {Path}", httpContext.Request.Method, httpContext.Request.Path);
                problem = new ProblemDetails
                {
                    Status = StatusCodes.Status500InternalServerError,
                    Title = "Something went wrong",
                    Detail = "An unexpected error occurred. Please try again."
                };
                break;
        }

        httpContext.Response.StatusCode = problem.Status ?? 500;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            ProblemDetails = problem,
            Exception = exception
        });
    }
}

public sealed class SecurityHeadersMiddleware(RequestDelegate next)
{
    public Task InvokeAsync(HttpContext context)
    {
        var h = context.Response.Headers;
        h["X-Content-Type-Options"] = "nosniff";
        h["X-Frame-Options"] = "DENY";
        h["Referrer-Policy"] = "no-referrer";
        h["Cross-Origin-Opener-Policy"] = "same-origin";
        if (!context.Request.Path.StartsWithSegments("/swagger"))
            h["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'";
        // Private financial data must not be cached by shared caches.
        if (context.Request.Path.StartsWithSegments("/api") && !context.Request.Path.StartsWithSegments("/api/public"))
            h["Cache-Control"] = "no-store";
        return next(context);
    }
}
