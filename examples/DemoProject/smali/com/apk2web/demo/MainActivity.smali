.class public Lcom/apk2web/demo/MainActivity;
.super Landroidx/appcompat/app/AppCompatActivity;

.method protected onCreate(Landroid/os/Bundle;)V
    .locals 2
    invoke-super {p0, p1}, Landroidx/appcompat/app/AppCompatActivity;->onCreate(Landroid/os/Bundle;)V
    const v0, 0x7f0b0001
    invoke-virtual {p0, v0}, Lcom/apk2web/demo/MainActivity;->setContentView(I)V
    const v0, 0x7f080001
    invoke-virtual {p0, v0}, Lcom/apk2web/demo/MainActivity;->findViewById(I)Landroid/view/View;
    move-result-object v0
    new-instance v1, Lcom/apk2web/demo/MainActivity$1;
    invoke-direct {v1, p0}, Lcom/apk2web/demo/MainActivity$1;-><init>(Lcom/apk2web/demo/MainActivity;)V
    invoke-virtual {v0, v1}, Landroid/view/View;->setOnClickListener(Landroid/view/View$OnClickListener;)V
    return-void
.end method