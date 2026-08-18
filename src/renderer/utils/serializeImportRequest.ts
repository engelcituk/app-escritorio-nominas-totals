import type { ProcessImportGroupRequest } from '../../shared/types/payroll.js';

export function serializeImportRequest(request: ProcessImportGroupRequest): ProcessImportGroupRequest {
  return {
    year: request.year,
    files: request.files.map((file) => ({
      fileToken: file.fileToken,
      fortnight: file.fortnight,
      payrollType: file.payrollType,
      selectedConceptIds: [...file.selectedConceptIds],
      retainedEmployeeNumbers: [...file.retainedEmployeeNumbers],
      missingAcknowledged: file.missingAcknowledged,
      ...(file.duplicateDecision ? { duplicateDecision: file.duplicateDecision } : {}),
    })),
    ...(request.exportDirectoryToken ? { exportDirectoryToken: request.exportDirectoryToken } : {}),
    ...(request.replacedGroupId ? { replacedGroupId: request.replacedGroupId } : {}),
  };
}
