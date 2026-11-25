package com.krishnamurti.horizon.file.api;

import com.krishnamurti.horizon.file.api.command.ClaimFileCommand;
import com.krishnamurti.horizon.file.api.command.CleanupFileCommand;
import com.krishnamurti.horizon.file.api.command.PrepareFileCommand;
import com.krishnamurti.horizon.file.api.command.TransferFileCommand;
import com.krishnamurti.horizon.file.api.model.ClaimResult;
import com.krishnamurti.horizon.file.api.model.FileContent;
import com.krishnamurti.horizon.file.api.model.FileSnapshot;
import com.krishnamurti.horizon.file.api.model.TransferResult;
import com.krishnamurti.horizon.file.api.query.InspectFileQuery;
import com.krishnamurti.horizon.file.api.query.ReadFileQuery;

public interface FileService {
    FileSnapshot prepare(PrepareFileCommand command);

    TransferResult transfer(TransferFileCommand command);

    FileSnapshot inspect(InspectFileQuery query);

    ClaimResult claim(ClaimFileCommand command);

    FileContent openRead(ReadFileQuery query);

    void requestCleanup(CleanupFileCommand command);
}
