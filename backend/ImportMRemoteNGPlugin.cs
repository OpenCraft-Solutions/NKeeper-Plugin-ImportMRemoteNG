using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using NKeeper.Abstractions;

namespace NKeeper.Plugins.ImportMRemoteNG;

/// <summary>
/// The import-mremoteng plugin (docs/architecture.md §7.48): 1.x's mRemoteNG import, done by its frontend, which reads
/// and decrypts the file in the browser and applies it through core's own host API. Every package has a backend; this
/// one contributes nothing.
/// </summary>
public sealed class ImportMRemoteNGPlugin : IPlugin
{
    public void Contribute(IPluginContributions contributions, PluginContext context)
    {
    }

    public void ConfigureServices(IServiceCollection services, PluginContext context)
    {
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints, PluginContext context)
    {
    }
}
