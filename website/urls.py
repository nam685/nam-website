from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health),
    path("auth/login/", views.auth_login),
    path("auth/check/", views.auth_check),
    path("todo/", views.todo_list),
    path("projects/", views.project_list),
    path("thoughts/", views.thought_list),
    path("thoughts/create/", views.thought_create),
    path("feedback/", views.feedback_create),
    path("drawings/", views.drawing_list),
    path("drawings/upload/", views.drawing_upload),
    path("drawings/<int:drawing_id>/delete/", views.drawing_delete),
    path("github/contributions/", views.github_contributions),
    path("github/auth/", views.github_auth),
    path("github/callback/", views.github_callback),
    path("github/refresh-status/", views.github_refresh_status),
    path("listens/", views.listen_list),
    path("listens/auth/", views.listen_auth),
    path("listens/callback/", views.listen_callback),
    path("listens/stats/", views.listen_stats),
    path("listens/sync-status/", views.listen_sync_status),
]
