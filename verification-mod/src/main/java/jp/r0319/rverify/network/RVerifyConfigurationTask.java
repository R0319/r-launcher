package jp.r0319.rverify.network;

import java.util.function.Consumer;

import jp.r0319.rverify.RVerifyMod;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.server.network.ConfigurationTask;
import net.neoforged.neoforge.network.configuration.ICustomConfigurationTask;

/**
 * 接続の configuration フェーズで実行されるタスク。
 * クライアントへ MOD 一覧要求を送り、応答（ServerPayloadHandler）で
 * finishCurrentTask されるまで接続は PLAY へ進まない。
 */
public class RVerifyConfigurationTask implements ICustomConfigurationTask {
    public static final ConfigurationTask.Type TYPE =
            new ConfigurationTask.Type(RVerifyMod.MODID + ":verify");

    @Override
    public void run(Consumer<CustomPacketPayload> sender) {
        sender.accept(new ModListRequestPayload());
    }

    @Override
    public ConfigurationTask.Type type() {
        return TYPE;
    }
}
