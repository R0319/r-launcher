package jp.r0319.rverify.network;

import jp.r0319.rverify.core.VerificationResult;
import jp.r0319.rverify.server.ServerVerification;
import net.minecraft.network.chat.Component;
import net.neoforged.neoforge.network.handling.IPayloadContext;

/**
 * サーバー側: クライアントの MOD 一覧を受け取り、manifest と照合。
 * 合格なら configuration タスクを完了、不合格なら理由を添えて切断。
 */
public final class ServerPayloadHandler {
    private ServerPayloadHandler() {}

    public static void handleResponse(final ModListResponsePayload payload, final IPayloadContext context) {
        VerificationResult result = ServerVerification.verify(payload.mods());
        if (result.ok()) {
            context.finishCurrentTask(RVerifyConfigurationTask.TYPE);
        } else {
            context.disconnect(Component.literal(result.message()));
        }
    }
}
