from django.contrib import admin

from .models import Drawing, Feedback, Project, Thought, TodoItem, TodoSection


@admin.register(Drawing)
class DrawingAdmin(admin.ModelAdmin):
    list_display = ["__str__", "category", "is_published", "created_at"]
    list_editable = ["is_published"]
    list_filter = ["category", "is_published"]


@admin.register(Feedback)
class FeedbackAdmin(admin.ModelAdmin):
    list_display = ["__str__", "ip_address", "created_at"]
    readonly_fields = ["message", "ip_address", "created_at"]


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
