package jp.r0319.rverify.core;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * EC2 の /modpacks/:id/manifest を取得して ManifestEntry 一覧へ変換する（ローダー非依存）。
 * 接続のたびに叩かないよう TTL キャッシュを持つ。Gson は Minecraft のクラスパスに含まれる。
 */
public final class ManifestClient {
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    private final Gson gson = new Gson();
    private final long ttlMs;

    private List<ManifestEntry> cache;
    private long cacheExpires = 0L;

    public ManifestClient(long ttlMs) {
        this.ttlMs = ttlMs;
    }

    public synchronized List<ManifestEntry> fetch(String url) throws Exception {
        long now = System.currentTimeMillis();
        if (cache != null && now < cacheExpires) {
            return cache;
        }
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(15))
                .GET()
                .build();
        HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() != 200) {
            throw new RuntimeException("manifest HTTP " + res.statusCode());
        }
        JsonObject root = gson.fromJson(res.body(), JsonObject.class);
        JsonArray mods = root.getAsJsonArray("mods");
        List<ManifestEntry> list = new ArrayList<>();
        if (mods != null) {
            for (int i = 0; i < mods.size(); i++) {
                JsonObject m = mods.get(i).getAsJsonObject();
                list.add(new ManifestEntry(
                        m.get("fileName").getAsString(),
                        m.get("sha256").getAsString(),
                        m.get("side").getAsString()));
            }
        }
        cache = list;
        cacheExpires = now + ttlMs;
        return list;
    }

    public synchronized void invalidate() {
        cache = null;
    }
}
