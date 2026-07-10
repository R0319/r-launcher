package jp.r0319.rverify.server;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import jp.r0319.rverify.RVerifyConfig;
import jp.r0319.rverify.RVerifyMod;
import jp.r0319.rverify.core.BaselineStore;
import jp.r0319.rverify.core.ManifestEntry;
import jp.r0319.rverify.core.ModEntry;
import jp.r0319.rverify.core.VerificationResult;
import jp.r0319.rverify.core.Verifier;
import net.neoforged.fml.loading.FMLPaths;

/**
 * 受け取ったクライアント MOD 一覧を、以下いずれかの基準と照合する薄いブリッジ。
 * - manifestUrl 設定あり: その URL を取得して照合（本番: EC2 の /manifest 等）。
 * - manifestUrl 空: ローカル baseline モード。初回接続の構成を config に保存し、以後それと照合。
 * 照合基準が用意できないとき（HTTP失敗）は fail-open（launcher 側が本来の強制を担うため）。
 */
public final class ServerVerification {
    private ServerVerification() {}

    public static VerificationResult verify(List<ModEntry> clientMods) {
        String url = RVerifyConfig.MANIFEST_URL.get().trim();
        String header = RVerifyConfig.KICK_HEADER.get();

        List<String> patterns = new ArrayList<>();
        for (String s : RVerifyConfig.ALLOWED_PATTERNS_CSV.get().split(",")) {
            String t = s.trim();
            if (!t.isEmpty()) patterns.add(t);
        }

        List<ManifestEntry> manifest;
        if (url.isEmpty()) {
            // --- ローカル baseline モード ---
            Path file = FMLPaths.CONFIGDIR.get().resolve(RVerifyConfig.BASELINE_FILE.get());
            try {
                if (!BaselineStore.exists(file)) {
                    // 初回: この構成を信頼して baseline 化し、今回は通す。
                    BaselineStore.capture(file, clientMods);
                    RVerifyMod.LOGGER.info(
                            "[rverify] baseline captured to {} ({} mods) — 以後この構成と照合します",
                            file, clientMods.size());
                    return VerificationResult.pass();
                }
                manifest = BaselineStore.load(file);
            } catch (Exception e) {
                RVerifyMod.LOGGER.error("[rverify] baseline 読み書きに失敗 — fail-open", e);
                return VerificationResult.pass();
            }
        } else {
            // --- manifest URL モード ---
            try {
                manifest = RVerifyMod.MANIFEST.fetch(url);
            } catch (Exception e) {
                RVerifyMod.LOGGER.error("[rverify] manifest fetch failed from {} — 検証をスキップ(fail-open)", url, e);
                return VerificationResult.pass();
            }
        }
        return Verifier.verify(manifest, clientMods, patterns, header);
    }
}
