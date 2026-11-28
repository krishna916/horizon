package com.krishnamurti.horizon.file.application;

import java.time.Instant;

public interface RecoveryClock {
    Instant now();
}
