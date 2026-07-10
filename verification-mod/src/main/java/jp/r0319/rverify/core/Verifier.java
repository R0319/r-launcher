package jp.r0319.rverify.core;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 検証ロジック本体（ローダー非依存）。
 * - 不足: manifest の required_both / client_required にあるのにクライアントに無い（sha256一致で判定）
 * - 余分: クライアントにあるが、(a) manifest のどのエントリの sha256 とも一致せず、
 *         (b) client_optional の名前stem（バージョン抜き）にも一致せず、
 *         (c) 手動許可リスト(allowedNamePatterns)にも一致しない
 * どちらか1つでもあれば失敗。
 *
 * client_optional は「クライアント任意」= 持っていてもよい/無くてもよい。これにより
 * 許可リストを manifest 側（modpack管理）から自動生成でき、手動保守が不要になる。
 */
public final class Verifier {
    private Verifier() {}

    public static VerificationResult verify(
            List<ManifestEntry> manifest,
            List<ModEntry> clientMods,
            List<String> allowedNamePatterns,
            String kickHeader) {

        Set<String> knownSha = new HashSet<>();          // manifest 全 side の sha256
        List<ManifestEntry> requiredEntries = new ArrayList<>(); // クライアント必須
        Set<String> optionalStems = new HashSet<>();     // client_optional の名前stem
        for (ManifestEntry e : manifest) {
            knownSha.add(e.sha256().toLowerCase(Locale.ROOT));
            switch (e.side()) {
                case "required_both", "client_required" -> requiredEntries.add(e);
                case "client_optional" -> optionalStems.add(nameStem(e.fileName()));
                default -> { /* server_only 等はクライアント検証に無関係 */ }
            }
        }

        Set<String> clientSha = new HashSet<>();
        for (ModEntry c : clientMods) {
            clientSha.add(c.sha256().toLowerCase(Locale.ROOT));
        }

        List<String> missing = new ArrayList<>();
        for (ManifestEntry e : requiredEntries) {
            if (!clientSha.contains(e.sha256().toLowerCase(Locale.ROOT))) {
                missing.add(e.fileName());
            }
        }

        List<String> extra = new ArrayList<>();
        for (ModEntry c : clientMods) {
            String sha = c.sha256().toLowerCase(Locale.ROOT);
            if (knownSha.contains(sha)) continue;                       // manifest と完全一致
            if (optionalStems.contains(nameStem(c.fileName()))) continue; // client_optional（版違い許容）
            if (isAllowed(c.fileName(), allowedNamePatterns)) continue;   // 手動許可リスト
            extra.add(c.fileName());
        }

        if (missing.isEmpty() && extra.isEmpty()) {
            return VerificationResult.pass();
        }

        StringBuilder sb = new StringBuilder(kickHeader);
        if (!missing.isEmpty()) {
            sb.append("\n[不足しているMOD] ").append(String.join(", ", missing));
        }
        if (!extra.isEmpty()) {
            sb.append("\n[許可されていないMOD] ").append(String.join(", ", extra));
        }
        return VerificationResult.fail(sb.toString());
    }

    /**
     * ファイル名からバージョンを除いた名前stemを取り出す。
     * 例: "sodium-neoforge-0.8.12-beta.2+mc1.21.1.jar" -> "sodium-neoforge"
     *     "BetterF3-11.0.3-NeoForge-1.21.1.jar"        -> "betterf3"
     * ハイフン区切りで、数字始まりのトークンが出たらそこで打ち切る。
     */
    static String nameStem(String fileName) {
        String base = fileName.toLowerCase(Locale.ROOT).replaceFirst("\\.jar$", "");
        String[] parts = base.split("-");
        StringBuilder stem = new StringBuilder();
        for (String p : parts) {
            if (!p.isEmpty() && Character.isDigit(p.charAt(0))) break; // バージョン開始
            if (stem.length() > 0) stem.append('-');
            stem.append(p);
        }
        return stem.length() == 0 ? base : stem.toString();
    }

    private static boolean isAllowed(String fileName, List<String> patterns) {
        String f = fileName.toLowerCase(Locale.ROOT);
        for (String p : patterns) {
            if (p == null || p.isBlank()) continue;
            if (f.contains(p.toLowerCase(Locale.ROOT))) return true;
        }
        return false;
    }
}
