.class public Lcom/apk2web/demo/GameActivity;
.super Landroid/app/Activity;

.method protected onCreate(Landroid/os/Bundle;)V
    .locals 2
    const v0, 0x7f0b0002
    invoke-virtual {p0, v0}, Lcom/apk2web/demo/GameActivity;->setContentView(I)V
    const v0, 0x7f080002
    invoke-virtual {p0, v0}, Lcom/apk2web/demo/GameActivity;->findViewById(I)Landroid/view/View;
    move-result-object v0
    new-instance v1, Lcom/apk2web/demo/GameActivity$1;
    invoke-direct {v1, p0}, Lcom/apk2web/demo/GameActivity$1;-><init>(Lcom/apk2web/demo/GameActivity;)V
    invoke-virtual {v0, v1}, Landroid/view/View;->setOnClickListener(Landroid/view/View$OnClickListener;)V
    return-void
.end method