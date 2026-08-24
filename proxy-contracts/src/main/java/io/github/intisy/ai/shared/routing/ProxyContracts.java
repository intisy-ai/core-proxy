package io.github.intisy.ai.shared.routing;

import io.github.intisy.ai.tsemit.TsConstant;

/**
 * The typed key this package mints.
 *
 * @implNote The Java field type is {@code Object} and its value {@code null} because the Java side
 * never reads a key: a Java host keys on the id string, and the typed key exists for the emitted
 * TypeScript.
 */
public final class ProxyContracts {

    @TsConstant(type = "CapabilityType<FrontDoorCapability>", id = "front-door")
    public static final Object FRONT_DOOR = null;

    private ProxyContracts() {
    }
}
