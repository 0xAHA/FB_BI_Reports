package com.fbi.plugins.reportbtn.editor;

import com.fbi.sdk.constants.bi.AccessLevelConst;

import java.util.List;
import java.util.function.IntFunction;

/**
 * Who may change what. Fishbowl's server checks none of these rights on BI saves,
 * so this is the gate; it is re-checked immediately before every save.
 *
 *   Page with reports      BI Editor-Edit and Edit Settings on every report using it
 *   Page with no report    BI Editor-Edit
 *   Script/Style/Template  BI Editor-Edit (shared: they change every page that includes them)
 *   Image                  never here (the BI Editor module edits images)
 *   Report access          BI Report-Edit and Edit Settings on that report
 *   Unpublish              page editable and BI Report-Delete (it deletes the report)
 *   Dashboard gadget       page editable and BI Report-Edit (bireport.widget)
 *   System app             never its code, name, description or folder (it ships
 *                          with Fishbowl: duplicate it to change it); its Active,
 *                          Published, gadget, access and Apps menus follow the rules
 *                          above (its Apps menus are kept in MenuOverrides, not its code)
 *
 * Admin may do everything except change a system app. Pure: Rights is filled from
 * the client by EditorFeature.
 */
final class AccessPolicy {

    enum Target { PAGE, SCRIPT, STYLE, TEMPLATE, IMAGE }

    /** One report using the page. */
    static final class Report {
        final int id;
        final String name;
        /** Offered as a gadget on the home dashboard (bireport.widget). */
        final boolean widget;

        Report(int id, String name) {
            this(id, name, false);
        }

        Report(int id, String name, boolean widget) {
            this.id = id;
            this.name = name;
            this.widget = widget;
        }
    }

    static final class Rights {
        final boolean admin;
        final boolean biEditorEdit;
        final boolean biReportEdit;
        final boolean biReportDelete;
        /** BI Editor-Delete: deleting records in the explorer. */
        final boolean biEditorDelete;
        final IntFunction<AccessLevelConst> level;

        Rights(boolean admin, boolean biEditorEdit, boolean biReportEdit, boolean biReportDelete,
               IntFunction<AccessLevelConst> level) {
            this(admin, biEditorEdit, biReportEdit, biReportDelete, false, level);
        }

        Rights(boolean admin, boolean biEditorEdit, boolean biReportEdit, boolean biReportDelete, boolean biEditorDelete,
               IntFunction<AccessLevelConst> level) {
            this.admin = admin;
            this.biEditorEdit = biEditorEdit;
            this.biReportEdit = biReportEdit;
            this.biReportDelete = biReportDelete;
            this.biEditorDelete = biEditorDelete;
            this.level = level;
        }
    }

    static final class Decision {
        /** The record's code, name and description (for a page also its folder and Apps menus). */
        final boolean canEdit;
        /** Why not, ready to show; "" when allowed. */
        final String reason;
        /** Active and Published: true for a system app the user could otherwise edit. */
        final boolean canEditFlags;
        final boolean canEditAccess;
        final String accessReason;
        final boolean canUnpublish;
        final boolean canEditGadget;
        final String gadgetReason;

        Decision(boolean canEdit, String reason, boolean canEditFlags, boolean canEditAccess, String accessReason,
                 boolean canUnpublish, boolean canEditGadget, String gadgetReason) {
            this.canEdit = canEdit;
            this.reason = reason;
            this.canEditFlags = canEditFlags;
            this.canEditAccess = canEditAccess;
            this.accessReason = accessReason;
            this.canUnpublish = canUnpublish;
            this.canEditGadget = canEditGadget;
            this.gadgetReason = gadgetReason;
        }
    }

    private AccessPolicy() {
    }

    /** Why a system app can't be changed, ready to show. */
    static final String SYSTEM_REASON = "This is a Fishbowl system app, so it can't be changed. Duplicate it to make "
        + "a custom copy you can edit.";

    static Decision decide(Target target, List<Report> reports, Rights r) {
        return decide(target, reports, r, false);
    }

    /** As decide, for a page that may be a system app: its code is locked, its flags and access are not. */
    static Decision decide(Target target, List<Report> reports, Rights r, boolean system) {
        Decision d = byRights(target, reports, r);
        if (!system || target != Target.PAGE) {
            return d;
        }
        return new Decision(false, SYSTEM_REASON, d.canEdit, d.canEditAccess, d.accessReason, d.canUnpublish,
            d.canEditGadget, d.gadgetReason);
    }

    private static Decision byRights(Target target, List<Report> reports, Rights r) {
        if (target == Target.IMAGE) {
            return new Decision(false, "Images are edited in the BI Editor module.", false, false, "", false, false, "");
        }
        if (r.admin) {
            return new Decision(true, "", true, target == Target.PAGE && !reports.isEmpty(), "", target == Target.PAGE,
                target == Target.PAGE, "");
        }
        String edit = "";
        if (!r.biEditorEdit) {
            edit = "Editing needs the BI Editor-Edit right.";
        } else if (target == Target.PAGE) {
            for (Report rep : reports) {
                AccessLevelConst lv = r.level.apply(rep.id);
                if (lv != AccessLevelConst.EDIT_SETTINGS) {
                    String level = lv == null || lv == AccessLevelConst.NONE ? "none" : lv.getName();
                    edit = "Your access to \"" + rep.name + "\" is " + level + "; editing it needs Edit Settings"
                        + (reports.size() > 1 ? " on every app that uses this page (" + reports.size() + ")." : ".");
                    break;
                }
            }
        }
        boolean canEdit = edit.isEmpty();

        String access = "";
        if (target != Target.PAGE || reports.isEmpty()) {
            access = "Only a published app has access settings.";
        } else if (!r.biReportEdit) {
            access = "Changing who can open an app needs the BI Report-Edit right.";
        } else {
            for (Report rep : reports) {
                if (r.level.apply(rep.id) != AccessLevelConst.EDIT_SETTINGS) {
                    access = "Changing access to \"" + rep.name + "\" needs Edit Settings on it.";
                    break;
                }
            }
        }
        boolean canUnpublish = canEdit && target == Target.PAGE && r.biReportDelete;
        String gadget = target != Target.PAGE ? "Only an app can be a dashboard gadget."
            : !canEdit ? edit
            : !r.biReportEdit ? "Changing the dashboard gadget needs the BI Report-Edit right." : "";
        return new Decision(canEdit, edit, canEdit, access.isEmpty(), access, canUnpublish, gadget.isEmpty(), gadget);
    }

    /**
     * Deleting a record: editable by rights, plus BI Editor-Delete. "" when allowed.
     * System and built-in apps pass this but aren't deleted: AppActions offers to
     * deactivate them instead.
     */
    static String deleteRefusal(Target target, List<Report> reports, Rights r) {
        Decision d = byRights(target, reports, r);
        if (!d.canEdit) {
            return d.reason;
        }
        return r.admin || r.biEditorDelete ? "" : "Deleting needs the BI Editor-Delete right.";
    }

    static Target target(int typeId) {
        switch (typeId) {
            case 10: return Target.PAGE;
            case 20: return Target.SCRIPT;
            case 30: return Target.STYLE;
            case 40: return Target.TEMPLATE;
            default: return Target.IMAGE;
        }
    }

    /** The native editor's rules: a name and description, at most 64 characters, no underscore. "" when valid. */
    static String validateName(String name, String description) {
        if (name == null || name.trim().isEmpty()) {
            return "A name is required.";
        }
        if (name.length() > 64) {
            return "The name can be at most 64 characters.";
        }
        if (name.contains("_")) {
            return "The name cannot contain '_' (Fishbowl uses it for spaces in include names).";
        }
        if (description == null || description.trim().isEmpty()) {
            return "A description is required.";
        }
        return "";
    }
}
