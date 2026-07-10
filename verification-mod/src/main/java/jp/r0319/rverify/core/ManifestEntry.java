package jp.r0319.rverify.core;

/**
 * サーバー側 manifest の1エントリ。EC2 の /modpacks/:id/manifest が返す
 * {@code { fileName, sha256, side }} に対応（downloadUrl / modId は検証に不要なので省略）。
 * side: "required_both" | "client_required" | "server_only"
 */
public record ManifestEntry(String fileName, String sha256, String side) {}
