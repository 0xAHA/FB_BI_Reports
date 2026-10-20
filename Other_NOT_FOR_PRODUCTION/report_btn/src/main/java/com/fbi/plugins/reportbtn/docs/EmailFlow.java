package com.fbi.plugins.reportbtn.docs;

import com.evnt.client.EmailSettingsPanel;
import com.evnt.client.modules.ClientModuleImpl;
import com.fbi.plugins.reportbtn.WorkspaceHost;
import com.fbi.plugins.reportbtn.docs.mail.EmailAddresses;
import com.fbi.plugins.reportbtn.docs.mail.EmailComposer;
import com.fbi.plugins.reportbtn.docs.mail.EmailDraft;
import com.fbi.plugins.reportbtn.docs.mail.EmailTemplates;
import com.fbi.plugins.reportbtn.docs.mail.EmailTokens;
import com.fbi.plugins.reportbtn.docs.mail.OwnMailProgram;

import javax.swing.SwingWorker;
import java.awt.Component;
import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * From a document's PDF to an email: the module's template (subject and body) with
 * the record's tokens filled, its email address as To, the PDF attached. Then the
 * rich email window, or the user's own email program when they chose that.
 */
final class EmailFlow {

    private EmailFlow() {
    }

    static void start(Component parent, DocSlots.Slot slot, int recordId, String num, File pdf) {
        WorkspaceHost host = Docs.hostOrExplain(parent);
        if (host == null) {
            return;
        }
        int userId = host.userId();
        EmailTokens.Record rec = EmailTokens.forRecord(Docs::rows, slot.module.code, slot.module.table, recordId, userId);
        EmailTemplates.Template t = EmailTemplates.load(slot.module.mail.name());
        EmailDraft d = new EmailDraft();
        d.to.addAll(rec.to);
        String subject = Docs.blank(t.subject) ? slot.title + (Docs.blank(num) ? "" : " " + num) : t.subject;
        d.subject = EmailTokens.apply(subject, rec.tokens, false);
        d.html = EmailTemplates.withFooter(EmailTokens.apply(EmailTemplates.htmlBody(t), rec.tokens, true), footer());
        d.attachments.add(pdf);

        EmailComposer.Prefs prefs = new EmailComposer.Prefs() {
            @Override
            public boolean usesProgram() {
                return DocDefaults.usesMailProgram(userId);
            }

            @Override
            public void setUsesProgram(boolean on) throws Exception {
                DocDefaults.setUsesMailProgram(userId, on);
            }
        };
        // The address book behind To / Cc / Bcc, in the stock window's two tabs: the record's
        // own address and its customer's or vendor's contacts; the company's contacts and the users.
        EmailComposer.AddressBook book = new EmailComposer.AddressBook() {
            @Override
            public EmailAddresses.Book read() {
                List<EmailAddresses.Address> record = new ArrayList<>();
                for (String a : rec.to) {
                    record.add(new EmailAddresses.Address("", a, "This " + slot.module.noun));
                }
                record.addAll(EmailAddresses.forRecord(Docs::rows, slot.module.code, recordId));
                return new EmailAddresses.Book(EmailAddresses.recordTab(slot.module.code, record), record,
                    EmailAddresses.company(Docs::rows), slot.module.mail.name());
            }

            @Override
            public void log(String message, Throwable error) {
                Docs.log(message, error);
            }
        };
        String note = Docs.blank(t.source) ? "No email template is set for " + slot.module.noun + "s (Tools › Options › Email)."
            : "Template: " + t.source;

        if (prefs.usesProgram()) {
            new SwingWorker<String, Void>() {
                @Override
                protected String doInBackground() throws Exception {
                    return OwnMailProgram.open(d);
                }

                @Override
                protected void done() {
                    try {
                        get();
                    } catch (Exception e) {
                        Throwable c = e.getCause() != null ? e.getCause() : e;
                        Docs.log("handing the email to the user's program failed", c);
                        Docs.error(parent, "Your email program didn't take the email (" + c.getMessage() + "). It opens here instead.");
                        EmailComposer.open(parent, d, note, prefs, book);
                    }
                }
            }.execute();
            return;
        }
        if (!emailSetUp()) {
            Docs.error(parent, "Email isn't set up on this PC (Tools › Options › Email). Or tick \"Open emails in my own "
                + "email program\" under Apps (beta) › Documents.");
            return;
        }
        EmailComposer.open(parent, d, note, prefs, book);
    }

    private static boolean emailSetUp() {
        try {
            return ClientModuleImpl.isEmailSetup();
        } catch (RuntimeException | LinkageError e) {
            return true;   // let the send say what's missing
        }
    }

    private static String footer() {
        try {
            String f = EmailSettingsPanel.getFooter();
            return f == null ? "" : f;
        } catch (RuntimeException | LinkageError e) {
            return "";
        }
    }
}
