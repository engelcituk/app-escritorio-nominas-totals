import type { ProcessMonthlyImportRequest } from '../../shared/types/payroll.js';

export function serializeImportRequest(request: ProcessMonthlyImportRequest): ProcessMonthlyImportRequest {
  return {
    year: request.year, month: request.month, conceptGroupId: request.conceptGroupId,
    files: request.files.map((file) => ({
      fileToken: file.fileToken,
      fortnight: file.fortnight,
      payrollTypeId: file.payrollTypeId,
      selectedConceptIds: [...file.selectedConceptIds],
      retainedEmployeeNumbers: [...file.retainedEmployeeNumbers],
      missingAcknowledged: file.missingAcknowledged,
      replaceActiveBatch: file.replaceActiveBatch,
    })),
    ...(request.exportDirectoryToken ? { exportDirectoryToken: request.exportDirectoryToken } : {}),
    ...(request.reconciliationId ? { reconciliationId: request.reconciliationId } : {}),
  };
}
