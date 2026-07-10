package jp.r0319.rverify.client;

import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import jp.r0319.rverify.RVerifyMod;
import jp.r0319.rverify.core.HashUtil;
import jp.r0319.rverify.core.ModEntry;
import net.neoforged.fml.loading.FMLPaths;

/**
 * クライアントの mods/ 配下の *.jar を走査し、ファイル名＋SHA-256 を集める。
 * launcher 側の modSync が扱う対象（mods/ の実体）と同じ粒度なので manifest と直接照合できる。
 */
public final class ClientModScanner {
    private ClientModScanner() {}

    public static List<ModEntry> scan() {
        List<ModEntry> out = new ArrayList<>();
        Path modsDir = FMLPaths.MODSDIR.get();
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(modsDir, "*.jar")) {
            for (Path p : ds) {
                try {
                    out.add(new ModEntry(p.getFileName().toString(), HashUtil.sha256(p)));
                } catch (Exception e) {
                    RVerifyMod.LOGGER.warn("[rverify] hash failed: {}", p, e);
                }
            }
        } catch (Exception e) {
            RVerifyMod.LOGGER.warn("[rverify] cannot scan mods dir", e);
        }
        return out;
    }
}
