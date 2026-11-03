# Reviewing a generated presentation

PPTimistic can check authored fields, geometry and parts of the PowerPoint file. A rendered image cannot show what a screen reader will announce. Complete the checks below on the actual `.pptx` before delivery.

1. Run `npm run build -- --project NAME`, `npm run validate -- --project NAME`, and `npm run render -- --project NAME`. Open the contact sheet, then inspect full-size slides with dense text, diagrams, images and charts. Record the renderer, locale and slide IDs inspected.
2. Open each delivery language in PowerPoint. Use **Review → Check Accessibility** and inspect its findings. Check the **Reading Order Pane** on representative slides, particularly title, diagram, chart, citation and footer. PowerPoint's [accessibility guidance](https://support.microsoft.com/en-us/accessibility/powerpoint/make-your-powerpoint-presentations-accessible-to-people-with-disabilities) explains these checks.
3. Confirm every meaningful image and chart has a useful localized description. Describe the information the visual conveys; a source citation alone is not a chart description. Check that decorative accents do not interrupt the reading order.
4. Verify the slide title is findable, the main message precedes supporting content, and notes retain scientific detail. Compare translated slides for omitted labels, numbers, units and captions.
5. Record unresolved warnings with stable slide IDs. If a reviewer changes the PPTX, keep a copy and reconcile approved changes into YAML before rebuilding; the generated file must not be silently overwritten.

The automated reports are evidence for this review, not a claim that a screen reader or PowerPoint Accessibility Checker passed. Do not upload a confidential deck to an external accessibility service without explicit approval.
