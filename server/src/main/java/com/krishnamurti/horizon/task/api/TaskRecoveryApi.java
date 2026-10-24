package com.krishnamurti.horizon.task.api;

/** Task-owned recovery operations exposed to other modules. */
public interface TaskRecoveryApi {

    TaskRecoverySnapshot restoreDeletedTask(Long taskId);
}
