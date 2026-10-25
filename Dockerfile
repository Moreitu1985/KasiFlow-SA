# KasiFlow SA API — container image for Render, Railway, Fly.io, Azure Container Apps, etc.
# Build from the repository root:  docker build -t kasiflow-api .
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY global.json KasiFlowSA.sln ./
COPY KasiFlow.Core/KasiFlow.Core.csproj KasiFlow.Core/
COPY KasiFlow.Api/KasiFlow.Api.csproj KasiFlow.Api/
RUN dotnet restore KasiFlow.Api/KasiFlow.Api.csproj
COPY KasiFlow.Core/ KasiFlow.Core/
COPY KasiFlow.Api/ KasiFlow.Api/
RUN dotnet publish KasiFlow.Api/KasiFlow.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app ./
# Migrations ship with the image so "dotnet KasiFlow.Api.dll migrate" works in a release step.
COPY database/ /app/database/
ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_HTTP_PORTS=8080 \
    DOTNET_RUNNING_IN_CONTAINER=true
EXPOSE 8080
USER app
ENTRYPOINT ["dotnet", "KasiFlow.Api.dll"]
