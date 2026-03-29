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
    path("drawings/", views.drawing_list),
    path("drawings/upload/", views.drawing_upload),
    path("github/contributions/", views.github_contributions),
    path("github/auth/", views.github_auth),
    path("github/callback/", views.github_callback),
    path("github/refresh-status/", views.github_refresh_status),
]
