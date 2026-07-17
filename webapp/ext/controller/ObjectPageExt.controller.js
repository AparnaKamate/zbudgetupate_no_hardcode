sap.ui.define([
	"sap/m/MessageToast",
	"sap/ui/core/Component"
], function (MessageToast, Component) {
	"use strict";

	// =========================================================================
	// CONFIGURATION
	// =========================================================================
	// Nothing is hardcoded here. Everything below is read at runtime from
	// manifest.json:
	//   - "zsapzbudgetupdate.toWbsVisibilityConfig" -> To-WBS section id/trigger
	//     value + which fields must stay read-only (VernrFrom/To, AvailAmtFrom/To)
	//   - "zsapzbudgetupdate.uploadConfig.service"  -> budget lookup GET call,
	//     reusing the SAME service block ListReportExt.controller.js already
	//     uses for the EXCEL_DATASet file upload (single source of truth)
	// To change any id/value/URL/credential, edit manifest.json only — this
	// file does not need to change.
	// =========================================================================

	return {

		// -----------------------------------------------------------------------
		// Lifecycle
		// -----------------------------------------------------------------------
		onInit: function () {
			var oView = this.getView ? this.getView() : this.base.getView();
			this._oView = oView;
			this._bPropertyChangeAttached = false;

			// Hide "To WBS" section immediately — covers the Create flow, where
			// the section must stay hidden until the user picks a Request type.
			this._setToWbsVisible(false);

			oView.attachModelContextChange(this._onModelContextChange, this);
			oView.addEventDelegate({ onAfterRendering: this._applyReadOnlyFields.bind(this) });
		},

		// -----------------------------------------------------------------------
		// Fires whenever the Object Page gets bound to a context — covers both
		// "Create" (new/transient context) and navigating into an existing
		// entry. Attaches the ONE shared propertyChange listener exactly once,
		// then re-evaluates the To-WBS section visibility for the new context.
		// -----------------------------------------------------------------------
		_onModelContextChange: function () {
			var oView = this._oView;
			var oContext = oView.getBindingContext();

			if (!oContext) {
				this._setToWbsVisible(false);
				return;
			}

			if (!this._bPropertyChangeAttached) {
				oContext.getModel().attachPropertyChange(this._onPropertyChange, this);
				this._bPropertyChangeAttached = true;
			}

			this._refreshToWbsVisibility();
		},

		// -----------------------------------------------------------------------
		// SINGLE shared handler for every model property change (both features
		// listen through this one handler so there's only one attachPropertyChange
		// registration on the model). For the row currently open on this Object
		// Page only:
		//   1. Request type changed        -> re-evaluate To-WBS section visibility
		//   2. FromWbs/FromYear changed    -> budget lookup for "From"
		//   3. ToWbs/ToYear changed        -> budget lookup for "To"
		// (F4 help itself is backend-driven via the Common.ValueList annotation
		// on FromWbs/ToWbs — selecting a value from it, or typing one manually,
		// both land here as a normal property change.)
		// -----------------------------------------------------------------------
		_onPropertyChange: function (oEvent) {
			var oView = this._oView;
			var oContext = oView.getBindingContext();
			var oChangedContext = oEvent.getParameter("context");
			var sPath = oEvent.getParameter("path");

			if (!oContext || !oChangedContext || oContext.getPath() !== oChangedContext.getPath()) {
				return; // change happened on a different row/context — ignore
			}

			var oVisibilityConfig = this._getVisibilityConfig();
			if (sPath === oVisibilityConfig.requestTypeTextProperty) {
				this._refreshToWbsVisibility();
			}

			if (sPath === "FromWbs" || sPath === "FromYear") {
				this._lookupBudget("From", oChangedContext);
			} else if (sPath === "ToWbs" || sPath === "ToYear") {
				this._lookupBudget("To", oChangedContext);
			}
		},

		// -----------------------------------------------------------------------
		// To-WBS section show/hide
		// -----------------------------------------------------------------------
		_findToWbsSection: function () {
			var oView = this._oView;
			var oConfig = this._getVisibilityConfig();
			var sTargetTitle = oConfig.toWbsSectionTitle.trim().toLowerCase();

			var aMatches = oView.findAggregatedObjects(true, function (oControl) {
				return oControl.isA && oControl.isA("sap.uxap.ObjectPageSection") &&
					(oControl.getTitle() || "").trim().toLowerCase() === sTargetTitle;
			});

			return aMatches && aMatches[0];
		},

		_setToWbsVisible: function (bVisible) {
			var oSection = this._findToWbsSection();
			if (oSection) {
				oSection.setVisible(bVisible);
			}
		},

		_refreshToWbsVisibility: function () {
			var oView = this._oView;
			var oContext = oView.getBindingContext();

			if (!oContext) {
				this._setToWbsVisible(false);
				return;
			}

			var oConfig = this._getVisibilityConfig();
			var oModel = oContext.getModel();
			var sPath = oContext.getPath();
			var sRequestTypeText = oModel.getProperty(sPath + "/" + oConfig.requestTypeTextProperty) || "";
			var bIsMatch = sRequestTypeText.trim().toLowerCase() === oConfig.transferValue.trim().toLowerCase();

			this._setToWbsVisible(bIsMatch);
		},

		// -----------------------------------------------------------------------
		// Read-only fields (VernrFrom/VernrTo/AvailAmtFrom/AvailAmtTo) — these are
		// only ever populated by the budget lookup below, so the user shouldn't
		// be able to type into them directly.
		// -----------------------------------------------------------------------
		_applyReadOnlyFields: function () {
			var oView = this._oView;
			var oConfig = this._getVisibilityConfig();
			var aFieldNames = oConfig.readOnlyFields || [];

			var aSmartFields = oView.findAggregatedObjects(true, function (oControl) {
				if (!oControl.isA || !oControl.isA("sap.ui.comp.smartfield.SmartField")) {
					return false;
				}
				var oBindingInfo = oControl.getBindingInfo("value");
				var sFieldPath = oBindingInfo && oBindingInfo.parts && oBindingInfo.parts[0] && oBindingInfo.parts[0].path;
				return sFieldPath && aFieldNames.indexOf(sFieldPath) > -1;
			});

			aSmartFields.forEach(function (oSmartField) {
				this._disableInnerControls(oSmartField);

				if (!oSmartField.__bReadOnlyListenerAttached) {
					oSmartField.__bReadOnlyListenerAttached = true;
					oSmartField.attachInnerControlsCreated(function () {
						this._disableInnerControls(oSmartField);
					}.bind(this));
				}
			}.bind(this));
		},

		_disableInnerControls: function (oSmartField) {
			var aInnerControls = oSmartField.getInnerControls ? oSmartField.getInnerControls() : [];
			aInnerControls.forEach(function (oInner) {
				if (oInner.setEnabled) {
					oInner.setEnabled(false);
				}
			});
		},

		// -----------------------------------------------------------------------
		// Config #1 — "zsapzbudgetupdate.toWbsVisibilityConfig"
		// -----------------------------------------------------------------------
		_getVisibilityConfig: function () {
			if (this._oVisibilityConfig) {
				return this._oVisibilityConfig;
			}
			this._oVisibilityConfig = this._readManifestSection("zsapzbudgetupdate.toWbsVisibilityConfig");
			return this._oVisibilityConfig;
		},

		// -----------------------------------------------------------------------
		// Config #2 — "zsapzbudgetupdate.uploadConfig" (reused for budget lookup;
		// same service ListReportExt.controller.js already uses for file upload)
		// -----------------------------------------------------------------------
		_getUploadConfig: function () {
			if (this._oUploadConfig) {
				return this._oUploadConfig;
			}
			this._oUploadConfig = this._readManifestSection("zsapzbudgetupdate.uploadConfig");
			return this._oUploadConfig;
		},

		// -----------------------------------------------------------------------
		// Shared manifest-section reader (same lookup strategy as
		// ListReportExt.controller.js._getConfig — looks up the app's OWN
		// Component by registered name, since Smart Template pages run inside
		// their own nested template component)
		// -----------------------------------------------------------------------
		_readManifestSection: function (sSectionName) {
			var APP_COMPONENT_NAME = "zsapzbudgetupdate.Component";
			var oAppComponent;

			Component.registry.forEach(function (oComp) {
				if (!oAppComponent && oComp.getMetadata().getName() === APP_COMPONENT_NAME) {
					oAppComponent = oComp;
				}
			});

			if (!oAppComponent) {
				var oView = this._oView;
				var oComponent = Component.getOwnerComponentFor(oView);
				var oOwner = oComponent && Component.getOwnerComponentFor(oComponent);
				while (oOwner) {
					oComponent = oOwner;
					oOwner = Component.getOwnerComponentFor(oComponent);
				}
				oAppComponent = oComponent;
			}

			var oManifestJson = oAppComponent && oAppComponent.getManifest();
			var oConfig = oManifestJson && oManifestJson[sSectionName];

			if (!oConfig) {
				throw new Error(
					"Section '" + sSectionName + "' not found in manifest.json. " +
					"Check that manifest.json was deployed/saved correctly and the app was reloaded."
				);
			}
			return oConfig;
		},

		// -----------------------------------------------------------------------
		// GET .../EXCEL_DATASet?$filter=(WBS_ELEMENT eq '...' and YEAR eq '...')
		// then map AVAILABLE_BUDGET -> AvailAmtFrom/To and USER_ID -> VernrFrom/To
		// -----------------------------------------------------------------------
		_lookupBudget: function (sPrefix, oContext) {
			var oModel = oContext.getModel();
			var sWbs = oModel.getProperty(sPrefix + "Wbs", oContext);
			var sYear = oModel.getProperty(sPrefix + "Year", oContext);

			if (!sWbs || !sYear) {
				return; // wait until both the WBS and the Year are filled in
			}

			var oService = this._getUploadConfig().service;
			var sFilter = "(WBS_ELEMENT eq '" + String(sWbs).replace(/'/g, "''") +
				"' and YEAR eq '" + String(sYear).replace(/'/g, "''") + "')";
			var sUrl = oService.url + oService.entitySet +
				"?$filter=" + encodeURIComponent(sFilter) + "&$format=json";

			var oHeaders = { "X-Requested-With": "X" };
			if (oService.user) {
				oHeaders.Authorization = "Basic " + btoa(oService.user + ":" + oService.password);
			}

			var oView = this._oView;

			jQuery.ajax({
				url: sUrl,
				type: "GET",
				headers: oHeaders,
				xhrFields: { withCredentials: true },
				success: function (oData) {
					var oResult = oData && oData.d && oData.d.results && oData.d.results[0];
					if (!oResult) {
						MessageToast.show("No budget data found for the selected WBS/Year.");
						return;
					}

					// The response can arrive after the user has navigated away or
					// changed rows — re-check the context is still the open one
					// before writing anything back to the model.
					var oCurrentContext = oView.getBindingContext();
					if (!oCurrentContext || oCurrentContext.getPath() !== oContext.getPath()) {
						return;
					}

					var sAmountField = sPrefix === "From" ? "AvailAmtFrom" : "AvailAmtTo";
					var sUserField = sPrefix === "From" ? "VernrFrom" : "VernrTo";

					oModel.setProperty(sAmountField, oResult.AVAILABLE_BUDGET, oContext);
					oModel.setProperty(sUserField, oResult.USER_ID, oContext);
				},
				error: function () {
					MessageToast.show("Could not fetch available budget for the " +
						(sPrefix === "From" ? "source" : "receiving") + " WBS.");
				}
			});
		}
	};
});
