using System.Net.Http.Json;
using System.Text.Json;
using NKeeper.Testing;

namespace NKeeper.Plugins.ImportMRemoteNG.Tests;

/// <summary>docs/architecture.md §7.48: the real <c>import-mremoteng</c> plugin, packaged by its build, loads into NKeeper's test server.</summary>
public sealed class ImportMRemoteNGPluginTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    [Fact]
    public async Task The_plugin_loads_with_its_frontend_and_contributes_nothing_to_the_backend()
    {
        var options = new TestServerOptions { ConnectionString = await postgres.CreateDatabaseAsync() };
        foreach (var package in DevelopmentKeys.BuiltPackages())
        {
            options.PluginPackages.Add(package);
        }

        await using var server = await TestServer.StartAsync(options, Token);
        using var admin = await server.SignedInClientAsync(Token);
        var plugins = await admin.Http.GetFromJsonAsync<JsonElement>(new Uri("/api/plugins", UriKind.Relative), Token);
        var plugin = plugins.EnumerateArray().Single(p => p.GetProperty("id").GetString() == "import-mremoteng");
        Assert.Equal("loaded", plugin.GetProperty("state").GetString());
        Assert.NotEqual(JsonValueKind.Null, plugin.GetProperty("frontendEntry").ValueKind);
        Assert.Empty(plugin.GetProperty("serviceTypes").EnumerateArray());
        Assert.Empty(plugin.GetProperty("hostActions").EnumerateArray());
    }
}
