package jp.r0319.rverify.network;

import java.util.List;

import jp.r0319.rverify.RVerifyMod;
import jp.r0319.rverify.core.ModEntry;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/** クライアント→サーバー: mods/ 配下の jar 一覧（ファイル名＋SHA-256）。 */
public record ModListResponsePayload(List<ModEntry> mods) implements CustomPacketPayload {
    public static final Type<ModListResponsePayload> TYPE =
            new Type<>(ResourceLocation.fromNamespaceAndPath(RVerifyMod.MODID, "mod_list_response"));

    private static final StreamCodec<FriendlyByteBuf, ModEntry> ENTRY_CODEC = StreamCodec.composite(
            ByteBufCodecs.STRING_UTF8, ModEntry::fileName,
            ByteBufCodecs.STRING_UTF8, ModEntry::sha256,
            ModEntry::new);

    public static final StreamCodec<FriendlyByteBuf, ModListResponsePayload> STREAM_CODEC =
            StreamCodec.composite(
                    ENTRY_CODEC.apply(ByteBufCodecs.list()), ModListResponsePayload::mods,
                    ModListResponsePayload::new);

    @Override
    public Type<ModListResponsePayload> type() {
        return TYPE;
    }
}
