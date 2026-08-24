// Bridges auth's decoupled OTP delivery to the mail plugin: the auth plugin
// stores the code and fires auth.EventOTPRequested; nothing sends the email
// unless the app subscribes. In dev the mail plugin's log driver just logs the
// send; in production configure MAIL_* (or a mail-* driver plugin).
package server

import (
	"context"
	"fmt"
	"os"

	auth "github.com/togo-framework/auth"
	mail "github.com/togo-framework/mail"
	"github.com/togo-framework/togo"
)

func mountOTPMail(k *togo.Kernel) {
	mailer, ok := mail.FromKernel(k)
	if !ok {
		return
	}
	k.Hooks.On(auth.EventOTPRequested, 50, func(ctx context.Context, payload any) error {
		p, ok := payload.(map[string]string)
		if !ok || p["subject"] == "" || p["code"] == "" {
			return nil
		}
		subject := "Your Mark It Down verification code"
		intro := "Use this code to sign in to Mark It Down."
		if p["purpose"] == "reset" {
			subject = "Reset your Mark It Down password"
			intro = "Use this code to reset your Mark It Down password."
		}
		from := os.Getenv("MAIL_FROM")
		if from == "" {
			from = "no-reply@markitdown.dev"
		}
		return mailer.Send(ctx, mail.Message{
			From:    from,
			To:      []string{p["subject"]},
			Subject: subject,
			Text:    fmt.Sprintf("%s\n\nYour code: %s\n\nIt expires in 10 minutes. If you didn't request this, ignore this email.", intro, p["code"]),
		})
	})
}
