package jp.r0319.rverify.core;

/** 検証結果。ok=true なら接続許可、false なら message を理由に切断。 */
public record VerificationResult(boolean ok, String message) {
    public static VerificationResult pass() {
        return new VerificationResult(true, "");
    }

    public static VerificationResult fail(String message) {
        return new VerificationResult(false, message);
    }
}
