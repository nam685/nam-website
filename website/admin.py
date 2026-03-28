from django.contrib import admin

from .models import Project, Thought, TodoItem, TodoSection


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ["title", "status", "order", "created_at"]
    list_editable = ["status", "order"]
    prepopulated_fields = {"slug": ["title"]}


@admin.register(Thought)
class ThoughtAdmin(admin.ModelAdmin):
    list_display = ["__str__", "is_published", "created_at"]
    list_editable = ["is_published"]
    list_filter = ["is_published"]


class TodoItemInline(admin.TabularInline):
    model = TodoItem
    extra = 0


@admin.register(TodoSection)
class TodoSectionAdmin(admin.ModelAdmin):
    inlines = [TodoItemInline]
    list_display = ["title", "order"]
    list_editable = ["order"]
