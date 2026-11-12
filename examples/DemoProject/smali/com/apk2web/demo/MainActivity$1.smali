.class Lcom/apk2web/demo/MainActivity$1;
.super Ljava/lang/Object;
.implements Landroid/view/View$OnClickListener;

.method public onClick(Landroid/view/View;)V
    .locals 2
    new-instance v0, Landroid/content/Intent;
    invoke-direct {v0}, Landroid/content/Intent;-><init>()V
    const-class v1, Lcom/apk2web/demo/GameActivity;
    invoke-virtual {v0, p0, v1}, Landroid/content/Intent;->setClass(Landroid/content/Context;Ljava/lang/Class;)Landroid/content/Intent;
    invoke-virtual {p0, v0}, Lcom/apk2web/demo/MainActivity;->startActivity(Landroid/content/Intent;)V
    return-void
.end method