package com.krishnamurti.horizon.file.domain;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.Duration;
import java.util.function.DoubleSupplier;

public final class FileRecoveryBackoff {
    private static final BigInteger BILLION = BigInteger.valueOf(1_000_000_000L);

    private FileRecoveryBackoff() {}

    public static Duration delay(
            Duration initial, Duration max, long consecutiveFailures, DoubleSupplier jitter) {
        if (initial == null
                || max == null
                || initial.isZero()
                || initial.isNegative()
                || max.isZero()
                || max.isNegative()
                || initial.compareTo(max) > 0
                || consecutiveFailures < 1
                || jitter == null) throw new IllegalArgumentException("Invalid recovery backoff");
        BigInteger cap = nanos(max), value = nanos(initial);
        for (long n = 1; n < consecutiveFailures && value.compareTo(cap) < 0; n++)
            value = value.shiftLeft(1).min(cap);
        double random = jitter.getAsDouble();
        if (!(random >= 0 && random < 1)) throw new IllegalArgumentException("Invalid jitter");
        BigInteger half = value.add(BigInteger.ONE).divide(BigInteger.TWO);
        BigInteger sample =
                new BigDecimal(value.subtract(half))
                        .multiply(BigDecimal.valueOf(random))
                        .toBigInteger();
        BigInteger[] parts = half.add(sample).divideAndRemainder(BILLION);
        return Duration.ofSeconds(parts[0].longValueExact(), parts[1].longValueExact());
    }

    private static BigInteger nanos(Duration d) {
        return BigInteger.valueOf(d.getSeconds())
                .multiply(BILLION)
                .add(BigInteger.valueOf(d.getNano()));
    }
}
