from django.db import models


class TodoSection(models.Model):
    title = models.CharField(max_length=200)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return self.title


class TodoItem(models.Model):
    section = models.ForeignKey(TodoSection, related_name="items", on_delete=models.CASCADE)
    text = models.TextField()
    done = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return self.text
