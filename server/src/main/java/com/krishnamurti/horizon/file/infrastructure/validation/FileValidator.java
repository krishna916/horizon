package com.krishnamurti.horizon.file.infrastructure.validation;

import com.krishnamurti.horizon.file.api.model.FileFormat;
import com.krishnamurti.horizon.file.infrastructure.staging.StagedFile;
import java.io.IOException;

public interface FileValidator {
    boolean supports(FileFormat format);

    ValidationResult validate(StagedFile stagedFile, FileFormat format) throws IOException;
}
