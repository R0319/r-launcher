package jp.r0319.rverify.core;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * ローカル baseline（信頼できる初回クライアントの MOD 構成）をファイルに保存/読込する（ローダー非依存）。
 * EC2 manifest を用意しなくても、最初に接続したクライアントの構成を基準に照合できる。
 * 形式: [{ "fileName", "sha256", "side" }]（side は常に required_both）。
 */
public final class BaselineStore {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private BaselineStore() {}

    public static boolean exists(Path file) {
        return Files.exists(file);
    }

    /** baseline を ManifestEntry 一覧として読み込む。 */
    public static List<ManifestEntry> load(Path file) throws Exception {
        JsonArray arr = GSON.fromJson(Files.readString(file), JsonArray.class);
        List<ManifestEntry> list = new ArrayList<>();
        if (arr != null) {
            for (int i = 0; i < arr.size(); i++) {
                JsonObject o = arr.get(i).getAsJsonObject();
                String side = o.has("side") ? o.get("side").getAsString() : "required_both";
                list.add(new ManifestEntry(
                        o.get("fileName").getAsString(),
                        o.get("sha256").getAsString(),
                        side));
            }
        }
        return list;
    }

    /** クライアントの現在の MOD 構成を baseline として書き出す（全て required_both 扱い）。 */
    public static void capture(Path file, List<ModEntry> clientMods) throws Exception {
        JsonArray arr = new JsonArray();
        for (ModEntry m : clientMods) {
            JsonObject o = new JsonObject();
            o.addProperty("fileName", m.fileName());
            o.addProperty("sha256", m.sha256());
            o.addProperty("side", "required_both");
            arr.add(o);
        }
        if (file.getParent() != null) Files.createDirectories(file.getParent());
        Files.writeString(file, GSON.toJson(arr));
    }
}
