package jp.r0319.rverify;

import net.neoforged.neoforge.common.ModConfigSpec;

/**
 * サーバー側設定（serverconfig/rverify-server.toml に生成される）。
 * リスト型は NeoForge バージョン差が出やすいので、許可リストはカンマ区切り文字列で持つ。
 */
public final class RVerifyConfig {
    public static final ModConfigSpec SPEC;
    public static final ModConfigSpec.ConfigValue<String> MANIFEST_URL;
    public static final ModConfigSpec.ConfigValue<String> BASELINE_FILE;
    public static final ModConfigSpec.ConfigValue<String> ALLOWED_PATTERNS_CSV;
    public static final ModConfigSpec.ConfigValue<String> KICK_HEADER;

    static {
        ModConfigSpec.Builder b = new ModConfigSpec.Builder();
        b.comment("R-Launcher Verify server settings");

        MANIFEST_URL = b
                .comment(
                        "照合先 manifest の URL（例: http://127.0.0.1:3000/modpacks/main/manifest）。",
                        "空にすると『ローカルbaselineモード』: 最初に接続したクライアントのMOD構成を",
                        "baselineFile に保存し、以後それと照合する（EC2 manifest 不要）。")
                .define("manifestUrl", "");

        BASELINE_FILE = b
                .comment("ローカルbaselineモード時の保存ファイル名（config/ 相対）。削除すると次回接続で再取得。")
                .define("baselineFile", "rverify-baseline.json");

        ALLOWED_PATTERNS_CSV = b
                .comment("manifest に無くても許可するクライアント専用MODのファイル名部分一致（カンマ区切り。例: iris,sodium）",
                        "この検証MOD自身(rverify)は既定で許可。")
                .define("allowedFileNamePatterns", "rverify");

        KICK_HEADER = b
                .comment("kick メッセージの先頭行")
                .define("kickHeader",
                        "R-Launcher: クライアントMODの検証に失敗しました。ランチャー(R-Launcher)経由で接続してください。");

        SPEC = b.build();
    }

    private RVerifyConfig() {}
}
