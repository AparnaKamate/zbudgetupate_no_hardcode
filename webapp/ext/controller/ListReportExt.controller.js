sap.ui.define([
	"sap/m/MessageBox",
	"sap/m/MessageToast",
	"sap/ui/model/json/JSONModel",
	"sap/ui/core/Fragment",
	"sap/ui/core/Component"
], function (MessageBox, MessageToast, JSONModel, Fragment, Component) {
	"use strict";

	// =========================================================================
	// CONFIGURATION
	// =========================================================================
	// NOTHING is hardcoded here anymore. All service URL/credentials, file
	// rules, and column mapping (matching "Excel_upload_Format_1.xlsx") live in
	// manifest.json under the "zsapzbudgetupdate.uploadConfig" section and are
	// read at runtime via _getConfig(). To change any of it (URL, user/pass,
	// sap-client, max file size, allowed extensions, column headers, etc.),
	// edit manifest.json only — this file does not need to change.
	// =========================================================================

	function isBlank(v, sBlankPlaceholder) {
		var s = (v === undefined || v === null) ? "" : String(v).trim();
		return s === "" || s === sBlankPlaceholder;
	}

	function normalizeHeader(sHeader) {
		return String(sHeader || "").trim().replace(/\s+/g, " ").toLowerCase();
	}

	return {

		// -----------------------------------------------------------------------
		// Entry point — wired via manifest.json "sap.ui.generic.app" > Actions
		// -----------------------------------------------------------------------
		onUploadBudgetFile: function () {
			this._getUploadDialog().then(function (oDialog) {
				this._resetDialog();
				oDialog.open();
			}.bind(this)).catch(function (oErr) {
				// eslint-disable-next-line no-console
				console.error("onUploadBudgetFile failed:", oErr);
				MessageBox.error(
					"Could not open the Upload File dialog.\n" +
					(oErr && oErr.message ? oErr.message : oErr)
				);
			});
		},

		// -----------------------------------------------------------------------
		// Config — read once from manifest.json ("zsapzbudgetupdate.uploadConfig")
		// and cached on the controller instance. This is the ONLY place config
		// values enter this file; nothing below is hardcoded.
		// -----------------------------------------------------------------------
		_getConfig: function () {
			if (this._oConfig) {
				return this._oConfig;
			}

			// Smart Template pages (ListReport/ObjectPage) run inside their OWN
			// nested template component (sap.suite.ui.generic.template.ListReport),
			// so Component.getOwnerComponentFor(view) returns THAT component —
			// not our app's own Component.js. Our config lives in the app's own
			// manifest.json, so look up that exact component by its registered
			// name instead of relying on view ownership.
			var APP_COMPONENT_NAME = "zsapzbudgetupdate.Component";
			var oAppComponent;

			Component.registry.forEach(function (oComp) {
				if (!oAppComponent && oComp.getMetadata().getName() === APP_COMPONENT_NAME) {
					oAppComponent = oComp;
				}
			});

			if (!oAppComponent) {
				// Fallback: climb the ownership chain upward from the view until
				// there is no further owner — that top-most component is the app.
				var oView = this.getView ? this.getView() : this.base.getView();
				var oComponent = Component.getOwnerComponentFor(oView);
				var oOwner = oComponent && Component.getOwnerComponentFor(oComponent);
				while (oOwner) {
					oComponent = oOwner;
					oOwner = Component.getOwnerComponentFor(oComponent);
				}
				oAppComponent = oComponent;
			}

			var oManifestJson = oAppComponent && oAppComponent.getManifest();
			var oConfig = oManifestJson && oManifestJson["zsapzbudgetupdate.uploadConfig"];

			if (!oConfig) {
				throw new Error(
					"Section 'zsapzbudgetupdate.uploadConfig' not found in manifest.json. " +
					"Check that manifest.json was deployed/saved correctly and the app was reloaded."
				);
			}
			this._oConfig = oConfig;
			return oConfig;
		},

		// -----------------------------------------------------------------------
		// Dialog handling
		// -----------------------------------------------------------------------
		_getUploadDialog: function () {
			if (this._oDialogPromise) {
				return this._oDialogPromise;
			}

			var oView = this.getView ? this.getView() : this.base.getView();
			var sViewId = oView.getId();

			this._oDialogPromise = Fragment.load({
				id: sViewId,
				name: "zsapzbudgetupdate.ext.fragment.FileUploadDialog",
				controller: this
			}).then(function (oDialog) {
				oView.addDependent(oDialog);

				this._oUploadModel = new JSONModel({ errors: [] });
				oDialog.setModel(this._oUploadModel, "upload");

				var oFileUploader = Fragment.byId(sViewId, "budgetFileUploader");
				oFileUploader.attachChange(this._onFileChange.bind(this));
				oFileUploader.attachTypeMissmatch(this._onTypeMismatch.bind(this));
				oFileUploader.attachFileSizeExceed(this._onFileSizeExceed.bind(this));
				oFileUploader.setMaximumFileSize(this._getConfig().upload.maxFileSizeMB);

				Fragment.byId(sViewId, "uploadConfirmBtn").attachPress(this._onConfirmUpload.bind(this));
				Fragment.byId(sViewId, "downloadErrorLogBtn").attachPress(this._onDownloadErrorLog.bind(this));
				Fragment.byId(sViewId, "cancelUploadBtn").attachPress(function () {
					oDialog.close();
				});

				return oDialog;
			}.bind(this));

			return this._oDialogPromise;
		},

		_resetDialog: function () {
			var oView = this.getView ? this.getView() : this.base.getView();
			var sViewId = oView.getId();

			this._oSelectedFile = null;
			this._oUploadModel.setData({ errors: [] });
			Fragment.byId(sViewId, "budgetFileUploader").clear();
			Fragment.byId(sViewId, "uploadConfirmBtn").setEnabled(false);
			Fragment.byId(sViewId, "validationErrorTable").setVisible(false);
			Fragment.byId(sViewId, "fileStatusText").setText("");
		},

		// -----------------------------------------------------------------------
		// FileUploader events
		// -----------------------------------------------------------------------
		_onTypeMismatch: function () {
			MessageBox.error("Only .xlsx, .xls or .csv files are allowed. Please select the correct file type.");
		},

		_onFileSizeExceed: function () {
			MessageBox.error("File size must not exceed " + this._getConfig().upload.maxFileSizeMB + " MB.");
		},

		_onFileChange: function (oEvent) {
			var oView = this.getView ? this.getView() : this.base.getView();
			var sViewId = oView.getId();

			this._oUploadModel.setData({ errors: [] });
			Fragment.byId(sViewId, "validationErrorTable").setVisible(false);
			Fragment.byId(sViewId, "uploadConfirmBtn").setEnabled(false);
			Fragment.byId(sViewId, "fileStatusText").setText("");

			var oFile = oEvent.getParameter("files") && oEvent.getParameter("files")[0];
			if (!oFile) {
				return;
			}

			var oUploadCfg = this._getConfig().upload;
			var sExt = oFile.name.split(".").pop().toLowerCase();
			if (oUploadCfg.allowedExtensions.indexOf(sExt) === -1) {
				MessageBox.error("Only ." + oUploadCfg.allowedExtensions.join(", .") + " files are allowed.");
				return;
			}
			if (oFile.size > oUploadCfg.maxFileSizeMB * 1024 * 1024) {
				MessageBox.error("File size must not exceed " + oUploadCfg.maxFileSizeMB + " MB.");
				return;
			}

			// keep the original raw file — this is what actually gets submitted to
			// the backend on Upload (the backend parses/validates it itself)
			this._oSelectedFile = oFile;

			var oReader = new FileReader();
			var that = this;

			oReader.onerror = function () {
				MessageBox.error("Could not read the file. Please try again.");
			};

			if (sExt === "csv") {
				oReader.onload = function (e) {
					var aData = that._parseCsv(String(e.target.result));
					that._processRows(aData);
				};
				oReader.readAsText(oFile, "UTF-8");
			} else {
				oReader.onload = function (e) {
					try {
						if (!window.XLSX) {
							MessageBox.error("Excel reader library did not load. Please check the thirdparty/xlsx include in manifest.json.");
							return;
						}
						var oWorkbook = window.XLSX.read(e.target.result, { type: "array" });
						var sSheet = oWorkbook.SheetNames[0];
						var oSheet = oWorkbook.Sheets[sSheet];
						var aData = window.XLSX.utils.sheet_to_json(oSheet, { header: 1, raw: false, defval: "" });
						that._processRows(aData);
					} catch (oErr) {
						MessageBox.error("Could not parse the Excel file: " + oErr.message);
					}
				};
				oReader.readAsArrayBuffer(oFile);
			}
		},

		// -----------------------------------------------------------------------
		// CSV parsing (RFC4180-ish: handles quoted fields with commas)
		// -----------------------------------------------------------------------
		_parseCsv: function (sText) {
			var aLines = sText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
				.filter(function (sLine) { return sLine.trim() !== ""; });

			return aLines.map(function (sLine) {
				var aFields = [];
				var sField = "";
				var bInQuotes = false;

				for (var i = 0; i < sLine.length; i++) {
					var c = sLine.charAt(i);
					if (bInQuotes) {
						if (c === '"') {
							if (sLine.charAt(i + 1) === '"') {
								sField += '"';
								i++;
							} else {
								bInQuotes = false;
							}
						} else {
							sField += c;
						}
					} else if (c === '"') {
						bInQuotes = true;
					} else if (c === ",") {
						aFields.push(sField);
						sField = "";
					} else {
						sField += c;
					}
				}
				aFields.push(sField);
				return aFields;
			});
		},

		// -----------------------------------------------------------------------
		// Validation
		// -----------------------------------------------------------------------
		_processRows: function (aData) {
			var oView = this.getView ? this.getView() : this.base.getView();
			var sViewId = oView.getId();
			var aErrors = [];
			var iValidRowCount = 0;

			var oConfig = this._getConfig();
			var oColumnMap = oConfig.columnMap;
			var oFieldLabel = oConfig.fieldLabel;
			var aRequiredHeaderColumns = oConfig.requiredHeaderColumns;
			var sBlankPlaceholder = oConfig.upload.blankPlaceholder;

			if (!aData || aData.length === 0) {
				MessageBox.error("The file is empty or could not be read.");
				return;
			}

			// ---- Header validation: locate the columns needed for the 4 checks below ----
			var aHeaderRaw = aData[0].map(normalizeHeader);
			var oColIndex = {}; // OData property -> column index in file
			aHeaderRaw.forEach(function (sHeader, iIdx) {
				if (oColumnMap.hasOwnProperty(sHeader)) {
					oColIndex[oColumnMap[sHeader]] = iIdx;
				}
			});

			var aMissingHeaders = aRequiredHeaderColumns.filter(function (sCol) {
				return !oColIndex.hasOwnProperty(sCol);
			});
			if (aMissingHeaders.length > 0) {
				MessageBox.error(
					"This file does not match the standard 'Budget Upload' template.\n" +
					"Missing/renamed column(s): " + aMissingHeaders.map(function (c) { return oFieldLabel[c] || c; }).join(", ") +
					"\n\nPlease use the given template file as-is (do not change column headers/order)."
				);
				return;
			}

			// ---- Row validation: only the 4 rules below are applied (client-side
			// pre-check, for instant feedback). The backend re-validates the file
			// fully (all VAL-xx rules) when it is actually submitted. ----
			// 1. Requested Amount < 0                         -> Applicable: All
			// 2. From WBS = To WBS                             -> Applicable: Transfer only
			// 3. Year field empty (Year(Source))               -> Applicable: All
			// 4. Justification empty                           -> Applicable: All
			for (var r = 1; r < aData.length; r++) {
				var aRow = aData[r];
				var iDisplayRow = r + 1; // 1-based, matches Excel row number

				var bBlankRow = !aRow || aRow.every(function (v) { return String(v || "").trim() === ""; });
				if (bBlankRow) {
					continue;
				}

				var oRaw = {}; // OData property -> raw trimmed string ("-" kept as-is here)
				Object.keys(oColIndex).forEach(function (sProp) {
					var vValue = aRow[oColIndex[sProp]];
					oRaw[sProp] = (vValue === undefined || vValue === null) ? "" : String(vValue).trim();
				});

				var aRowErrors = [];

				function addError(sField, sMessage) {
					aRowErrors.push({
						row: iDisplayRow,
						field: oFieldLabel[sField] || sField,
						message: "Row " + iDisplayRow + ": " + sMessage,
						source: "Client Validation"
					});
				}

				var sTypeRaw = (oRaw.RequestType || "").trim().toLowerCase();

				// Rule 1: Requested Amount < 0 — Applicable: All
				if (!isBlank(oRaw.RequestedAmt, sBlankPlaceholder)) {
					var fAmount = parseFloat(oRaw.RequestedAmt.replace(/,/g, ""));
					if (!isNaN(fAmount) && fAmount < 0) {
						addError("RequestedAmt", "Requested amount must not be negative.");
					}
				}

				// Rule 2: From WBS = To WBS — Applicable: Transfer only
				if (sTypeRaw === "transfer" && !isBlank(oRaw.FromWbs, sBlankPlaceholder) && !isBlank(oRaw.ToWbs, sBlankPlaceholder) &&
					oRaw.FromWbs.toLowerCase() === oRaw.ToWbs.toLowerCase()) {
					addError("ToWbs", "Source and receiving WBS cannot be the same.");
				}

				// Rule 3: Year field empty (Year(Source)) — Applicable: All
				if (isBlank(oRaw.FromYear, sBlankPlaceholder)) {
					addError("FromYear", "Fiscal year is mandatory.");
				}

				// Rule 4: Justification empty — Applicable: All
				if (isBlank(oRaw.Justification, sBlankPlaceholder)) {
					addError("Justification", "Reason/Justification is a mandatory field.");
				}

				if (aRowErrors.length > 0) {
					aErrors = aErrors.concat(aRowErrors);
				} else {
					iValidRowCount++;
				}
			}

			this._oUploadModel.setData({ errors: aErrors });

			if (aErrors.length > 0) {
				Fragment.byId(sViewId, "validationErrorTable").setVisible(true);
				Fragment.byId(sViewId, "uploadConfirmBtn").setEnabled(false);
				Fragment.byId(sViewId, "fileStatusText").setText(
					aErrors.length + " error(s) found. Please correct the file and select it again."
				);
			} else if (iValidRowCount === 0) {
				Fragment.byId(sViewId, "fileStatusText").setText("No valid data rows were found in the file.");
				Fragment.byId(sViewId, "uploadConfirmBtn").setEnabled(false);
			} else {
				Fragment.byId(sViewId, "validationErrorTable").setVisible(false);
				Fragment.byId(sViewId, "fileStatusText").setText(
					iValidRowCount + " row(s) validated successfully. Ready to upload."
				);
				Fragment.byId(sViewId, "uploadConfirmBtn").setEnabled(true);
			}
		},

		// -----------------------------------------------------------------------
		// Upload the raw file to the ZEXCEL_BUDGET_SRV OData service
		// -----------------------------------------------------------------------
		_onConfirmUpload: function () {
			var oView = this.getView ? this.getView() : this.base.getView();
			var sViewId = oView.getId();
			var oDialog = Fragment.byId(sViewId, "budgetFileUploadDialog");
			var oFile = this._oSelectedFile;
			var that = this;

			if (!oFile) {
				MessageBox.warning("Please choose a file first.");
				return;
			}

			oDialog.setBusy(true);
			Fragment.byId(sViewId, "uploadConfirmBtn").setEnabled(false);

			this._fetchCsrfToken()
				.then(function (sToken) {
					return that._uploadFile(sToken, oFile);
				})
				.then(function () {
					oDialog.setBusy(false);
					MessageToast.show("File uploaded successfully.");
					oDialog.close();

					var oExtensionAPI = that.extensionAPI ||
						(that.base && that.base.templateBaseExtension && that.base.templateBaseExtension.getExtensionAPI());
					if (oExtensionAPI && oExtensionAPI.rebindTable) {
						oExtensionAPI.rebindTable();
					}
				})
				.catch(function (jqXHR) {
					oDialog.setBusy(false);
					Fragment.byId(sViewId, "uploadConfirmBtn").setEnabled(true);

					var aBackendErrors = that._parseODataErrors(jqXHR);
					that._oUploadModel.setProperty("/errors", aBackendErrors);
					Fragment.byId(sViewId, "validationErrorTable").setVisible(true);
					Fragment.byId(sViewId, "fileStatusText").setText(
						"Upload failed — see error(s) below. Please fix the file and try again."
					);
				});
		},

		// -----------------------------------------------------------------------
		// ZEXCEL_BUDGET_SRV integration — direct call, raw file submitted as-is
		// -----------------------------------------------------------------------
		_fetchCsrfToken: function () {
			var oService = this._getConfig().service;
			var sUrl = oService.url + (oService.sapClientParams ? "?" + oService.sapClientParams : "");
			var oHeaders = {
				"X-CSRF-Token": "Fetch",
				"X-Requested-With": "X"
			};
			// Only send Basic Auth if credentials were actually configured — when
			// calling through a destination (as here), the destination itself
			// handles authentication and no credentials belong in this file.
			if (oService.user) {
				oHeaders.Authorization = "Basic " + btoa(oService.user + ":" + oService.password);
			}

			return new Promise(function (resolve, reject) {
				jQuery.ajax({
					url: sUrl,
					type: "GET",
					headers: oHeaders,
					xhrFields: { withCredentials: true },
					success: function (data, status, jqXHR) {
						resolve(jqXHR.getResponseHeader("X-CSRF-Token"));
					},
					error: reject
				});
			});
		},

		// POST the raw file binary to the EXCEL_DATASet media entity, exactly like
		// the "Add File" flow shown in the SAP Gateway Client / Postman screenshots.
		_uploadFile: function (sToken, oFile) {
			var oConfig = this._getConfig();
			var oService = oConfig.service;
			var sExt = oFile.name.split(".").pop().toLowerCase();
			var sContentType = oConfig.contentTypeMap[sExt] || "application/octet-stream";
			var sUrl = oService.url + oService.entitySet + (oService.sapClientParams ? "?" + oService.sapClientParams : "");

			return new Promise(function (resolve, reject) {
				var oXhr = new XMLHttpRequest();
				oXhr.open("POST", sUrl, true);
				oXhr.setRequestHeader("Content-Type", sContentType);
				oXhr.setRequestHeader("Accept", "application/json");
				oXhr.setRequestHeader("X-CSRF-Token", sToken);
				oXhr.setRequestHeader("X-Requested-With", "X");
				// carries the original filename to the backend (used to populate FNAME/FTYPE)
				// NOTE: if your backend expects a different header for the filename
				// (e.g. "X-File-Name" instead of "Slug"), change it here to match.
				oXhr.setRequestHeader("Slug", oFile.name);
				if (oService.user) {
					oXhr.setRequestHeader("Authorization", "Basic " + btoa(oService.user + ":" + oService.password));
				}
				oXhr.withCredentials = true;

				oXhr.onload = function () {
					if (oXhr.status >= 200 && oXhr.status < 300) {
						resolve(oXhr);
					} else {
						reject(oXhr);
					}
				};
				oXhr.onerror = function () {
					reject(oXhr);
				};
				oXhr.send(oFile);
			});
		},

		// -----------------------------------------------------------------------
		// Error response handling
		// -----------------------------------------------------------------------
		// Parses a standard SAP Gateway / OData v2 error body:
		//   { "error": { "code": "...", "message": { "value": "..." },
		//                "innererror": { "errordetails": [ { "message": "...", "severity": "..." }, ... ] } } }
		// Falls back gracefully to whatever text/status is available.
		_parseODataErrors: function (jqXHR) {
			var aMessages = [];

			try {
				var oBody = JSON.parse(jqXHR.responseText);
				var oError = oBody && oBody.error;

				if (oError) {
					if (oError.innererror && Array.isArray(oError.innererror.errordetails) && oError.innererror.errordetails.length > 0) {
						// multiple validation messages from the backend (e.g. several VAL-xx hits)
						oError.innererror.errordetails.forEach(function (oDetail) {
							aMessages.push({
								row: "",
								field: oDetail.code || "Backend",
								message: oDetail.message || JSON.stringify(oDetail),
								source: "Backend"
							});
						});
					} else if (oError.message && oError.message.value) {
						aMessages.push({ row: "", field: "Backend", message: oError.message.value, source: "Backend" });
					}
				}
			} catch (e) {
				// response wasn't JSON (could be XML/Atom) — fall through to generic handling
			}

			if (aMessages.length === 0) {
				var sFallback = (jqXHR && jqXHR.responseText && jqXHR.responseText.length < 300)
					? jqXHR.responseText
					: (jqXHR.statusText || "Request failed") + " (HTTP " + jqXHR.status + ")";
				aMessages.push({ row: "", field: "Backend", message: sFallback, source: "Backend" });
			}

			return aMessages;
		},

		// -----------------------------------------------------------------------
		// Error log download (client-side, no backend call — builds a CSV from
		// whatever is currently in the "upload>/errors" model, whether those came
		// from the 4 frontend validation rules or from the backend's error response)
		// -----------------------------------------------------------------------
		_onDownloadErrorLog: function () {
			var aErrors = (this._oUploadModel && this._oUploadModel.getProperty("/errors")) || [];
			if (aErrors.length === 0) {
				return;
			}
			if (!window.XLSX) {
				MessageBox.error("Excel library did not load. Please check the thirdparty/xlsx include in manifest.json.");
				return;
			}

			var sFileName = (this._oSelectedFile && this._oSelectedFile.name) || "unknown_file";
			var oNow = new Date();

			// Use a single, explicit IST (Asia/Kolkata) timestamp everywhere so the
			// date/time shown inside the file and the date/time in the filename
			// always match — regardless of the browser's/machine's own timezone.
			var oIstParts = new Intl.DateTimeFormat("en-GB", {
				timeZone: "Asia/Kolkata",
				day: "2-digit", month: "2-digit", year: "numeric",
				hour: "2-digit", minute: "2-digit", second: "2-digit",
				hour12: false
			}).formatToParts(oNow).reduce(function (o, p) { o[p.type] = p.value; return o; }, {});

			var sDisplayTimestamp = oIstParts.day + "-" + oIstParts.month + "-" + oIstParts.year + " " +
				oIstParts.hour + ":" + oIstParts.minute + ":" + oIstParts.second + " IST";
			var sFileTimestamp = oIstParts.year + "-" + oIstParts.month + "-" + oIstParts.day + "_" +
				oIstParts.hour + "-" + oIstParts.minute + "-" + oIstParts.second;

			var aSheetData = [
				["Source File", sFileName],
				["Generated On", sDisplayTimestamp],
				[],
				["Error Message"]
			];
			aErrors.forEach(function (oErr) {
				aSheetData.push([oErr.message || ""]);
			});

			var oWorksheet = window.XLSX.utils.aoa_to_sheet(aSheetData);
			oWorksheet["!cols"] = [{ wch: 100 }];
			var oWorkbook = window.XLSX.utils.book_new();
			window.XLSX.utils.book_append_sheet(oWorkbook, oWorksheet, "Error Log");

			var sDownloadName = "BudgetUpload_ErrorLog_" + sFileName.replace(/\.[^.]+$/, "") + "_" + sFileTimestamp + ".xlsx";
			window.XLSX.writeFile(oWorkbook, sDownloadName);
		}
	};
});