package jp.r0319.rverify.core;

/**
 * クライアントが所持する MOD jar 1件（ファイル名と SHA-256）。
 * ローダー非依存の純データ型。
 */
public record ModEntry(String fileName, String sha256) {}
