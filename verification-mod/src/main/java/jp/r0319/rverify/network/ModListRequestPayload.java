package jp.r0319.rverify.network;

import jp.r0319.rverify.RVerifyMod;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/** サーバー→クライアント: MOD一覧の送信要求（中身なし）。 */
public record ModListRequestPayload() implements CustomPacketPayload {
    public static final Type<ModListRequestPayload> TYPE =
            new Type<>(ResourceLocation.fromNamespaceAndPath(RVerifyMod.MODID, "mod_list_request"));

    public static final StreamCodec<FriendlyByteBuf, ModListRequestPayload> STREAM_CODEC =
            StreamCodec.unit(new ModListRequestPayload());

    @Override
    public Type<ModListRequestPayload> type() {
        return TYPE;
    }
}
