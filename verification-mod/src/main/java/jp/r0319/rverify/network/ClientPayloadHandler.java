package jp.r0319.rverify.network;

import jp.r0319.rverify.client.ClientModScanner;
import net.neoforged.neoforge.network.handling.IPayloadContext;

/**
 * クライアント側: MOD一覧要求を受け取り、mods/ を走査して応答する。
 * FMLPaths / ファイル操作のみで net.minecraft.client には触れないため、
 * サーバー環境でこのクラスが参照されても安全。
 */
public final class ClientPayloadHandler {
    private ClientPayloadHandler() {}

    public static void handleRequest(final ModListRequestPayload payload, final IPayloadContext context) {
        context.reply(new ModListResponsePayload(ClientModScanner.scan()));
    }
}
