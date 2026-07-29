import { sendMatrixAlert } from "./matrix.js";

// @ts-ignore
if (typeof registerAlertChannel !== 'undefined') {
    // @ts-ignore
    registerAlertChannel({
        type: "matrix",
        targetOption: "roomId",
        missingTargetError: "Matrix alerts require a roomId target",
        supportsSigning: false,
        send: sendMatrixAlert,
    });
}
