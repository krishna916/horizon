package com.krishnamurti.horizon.file.application;

import com.krishnamurti.horizon.file.api.FileService;
import com.krishnamurti.horizon.file.api.command.PrepareFileCommand;
import com.krishnamurti.horizon.file.api.model.FileSnapshot;
import java.util.function.Supplier;
import org.springframework.transaction.support.TransactionTemplate;

/** Test-only caller that owns the transaction required by File prepare and later claim APIs. */
public final class TestFileOwner {
    private final TransactionTemplate transactions;
    private final FileService files;

    public TestFileOwner(TransactionTemplate transactions, FileService files) {
        this.transactions = transactions;
        this.files = files;
    }

    public FileSnapshot prepare(PrepareFileCommand command) {
        return transactions.execute(status -> files.prepare(command));
    }

    public <T> T inTransaction(Supplier<T> operation) {
        return transactions.execute(status -> operation.get());
    }
}
