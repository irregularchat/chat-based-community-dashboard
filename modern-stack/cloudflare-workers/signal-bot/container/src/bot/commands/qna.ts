import { Command, CommandContext, CommandResponse } from './base-command';
import { isAdmin } from '../../utils/auth';

export class QnaCommand extends Command {
  public name = 'qna';
  public description = 'Q&A commands';
  public aliases = ['ask', 'q', 'question', 'questions', 'answer', 'a', 'solve', 'solved'];

  public async handle(context: CommandContext, args: string): Promise<CommandResponse> {
    const subCommand = context.message?.split(' ')[0].substring(1);
    switch (subCommand) {
      case 'ask':
      case 'q':
      case 'question':
        return this.handleAsk(context, args);
      case 'questions':
        return this.handleQuestions(context);
      case 'answer':
      case 'a':
        return this.handleAnswer(context, args);
      case 'solve':
      case 'solved':
        return this.handleSolve(context, args);
      default:
        return `❓ Unknown Q&A command.`;
    }
  }

  private async handleAsk(context: CommandContext, question: string): Promise<string> {
    if (!question || question.trim().length === 0) {
      return '❌ Please provide a question.\n\nUsage: !ask <your question>';
    }

    if (!context.groupId) {
      return '❌ Questions can only be asked in groups.';
    }

    try {
      const questionId = await this.db.getNextQuestionId(context.groupId);

      const sentences = question.split(/[.!?]/);
      const title = sentences[0]?.trim().substring(0, 100) || question.substring(0, 100);

      const breakout = this.breakoutManager ? await this.breakoutManager.getActiveBreakout(context.groupId) : null;
      let breakoutId: number | undefined;
      let annotationId: number | undefined;

      if (breakout && this.breakoutManager) {
        breakoutId = breakout.id;
        const annotationResult = await this.breakoutManager.handleAnnotation(
          context.groupId,
          'question',
          question,
          context.sourceUuid || context.sourceNumber,
          context.sourceName
        );
        const annotations = await this.db.getBreakoutAnnotations(breakout.id, 'question');
        const lastAnnotation = annotations[annotations.length - 1];
        if (lastAnnotation && lastAnnotation.content === question) {
          annotationId = lastAnnotation.id;
        }
      }

      const questionData = {
        questionId,
        question,
        title,
        asker: context.sourceName,
        askerPhone: context.sourceNumber,
        groupId: context.groupId,
        breakoutId,
        annotationId,
      };

      await this.db.saveQuestion(questionData);

      return this.formatForSignal(
        `✅ Question #${questionId} recorded!\n\n` +
        `Question: ${question}\n\n` +
        `📝 Others can answer with: !answer ${questionId} <answer>\n` +
        `   Or reply to this message with: !a <answer>\n\n` +
        `✔️  Mark answer(s) as solved: !solved ${questionId} <answer_ids>`
      );
    } catch (error) {
      console.error('Error saving question:', error);
      return `❌ Failed to save question: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private async handleQuestions(context: CommandContext): Promise<string> {
    if (!context.groupId) {
      return '❌ Questions can only be listed in groups.';
    }

    try {
      const questions = await this.db.getQuestions(context.groupId, false);

      if (questions.length === 0) {
        return '📋 No open questions in this group.\n\nAsk one with: !ask <question>';
      }

      const lines = [
        '📋 Open Questions:',
        '',
      ];

      for (const q of questions.slice(0, 10)) { // Limit to 10 most recent
        lines.push(`#${q.question_id} by ${q.asker}:`);
        lines.push(`  ${q.question.substring(0, 100)}${q.question.length > 100 ? '...' : ''}`);
        lines.push('');
      }

      lines.push(`Use: !answer <id> <answer> to respond`);

      return this.formatForSignal(lines.join('\n'));
    } catch (error) {
      console.error('Error loading questions:', error);
      return `❌ Failed to load questions: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private async handleAnswer(context: CommandContext, args: string): Promise<string> {
    if (!context.groupId) {
      return '❌ Answers can only be posted in groups.';
    }

    const parts = args.trim().split(/\s+/);

    let questionId: number;
    let answer: string;

    if (parts.length >= 2 && !isNaN(parseInt(parts[0]))) {
      questionId = parseInt(parts[0]);
      answer = parts.slice(1).join(' ');
    } else {
      return '❌ Please provide a question ID and answer.\n\nUsage: !answer <id> <answer>\n   or: !a <id> <answer>';
    }

    if (!answer || answer.trim().length === 0) {
      return '❌ Please provide an answer.\n\nUsage: !answer <id> <answer>';
    }

    try {
      const questionData = await this.db.getQuestionWithAnswers(questionId, context.groupId);

      if (!questionData) {
        return `❌ Question #${questionId} not found in this group.`;
      }

      const answerData = {
        questionId,
        answer,
        answerer: context.sourceName,
        answererPhone: context.sourceNumber,
        groupId: context.groupId,
      };

      const answerId = await this.db.saveAnswer(answerData);
      
      if (questionData.question.breakout_id && questionData.question.annotation_id) {
        await this.db.updateBreakoutAnnotationAnswered(
          questionData.question.annotation_id,
          context.sourceUuid || context.sourceNumber,
          context.sourceName
        );
      }

      const answerCount = questionData.answers.length + 1;

      return this.formatForSignal(
        `✅ Answer #${answerId} added to question #${questionId}!\n\n` +
        `❓ Question: ${questionData.question.question}\n\n` +
        `💬 Your answer: ${answer}\n\n` +
        `📊 Total answers: ${answerCount}\n\n` +
        `To mark this as the solution: !solved ${questionId} ${answerId}`
      );
    } catch (error) {
      console.error('Error adding answer:', error);
      return `❌ Failed to add answer: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private async handleSolve(context: CommandContext, args: string): Promise<string> {
    if (!context.groupId) {
      return '❌ This command can only be used in groups.';
    }

    let questionId: number;
    let answerIds: number[] = [];

    if (context.quotedText && (!args || args.trim() === '')) {
      const answerMatch = context.quotedText.match(/Answer #(\d+) for Question #(\d+):/);

      if (answerMatch) {
        const answerId = parseInt(answerMatch[1]);
        questionId = parseInt(answerMatch[2]);
        answerIds = [answerId];
        console.log(`📝 Extracted from quote: Question #${questionId}, Answer #${answerId}`);
      } else {
        return '❌ Could not extract question/answer IDs from quoted message.\n\nUsage: Reply to an !answer message with !solved, or use: !solved <question_id> <answer_id>';
      }
    } else {
      const parts = args.trim().split(/\s+/);

      if (parts.length < 2) {
        return '❌ Please provide question ID and at least one answer ID.\n\nUsage: !solved <question_id> <answer_id> [answer_id2...]\nOr reply to an !answer message with !solved';
      }

      questionId = parseInt(parts[0]);
      answerIds = parts.slice(1).map(id => parseInt(id)).filter(id => !isNaN(id));

      if (isNaN(questionId) || answerIds.length === 0) {
        return '❌ Invalid question or answer IDs.\n\nUsage: !solved <question_id> <answer_id> [answer_id2...]\nOr reply to an !answer message with !solved';
      }
    }

    try {
      const questionData = await this.db.getQuestionWithAnswers(questionId, context.groupId);

      if (!questionData) {
        return `❌ Question #${questionId} not found in this group.`;
      }

      if (questionData.question.asker_phone !== context.sourceNumber) {
        return `❌ Only the question asker (${questionData.question.asker}) can mark answers as solved.`;
      }

      const validAnswerIds: number[] = [];
      const invalidAnswerIds: number[] = [];

      for (const answerId of answerIds) {
        const answerExists = questionData.answers.some(a => a.answer_id === answerId);
        if (answerExists) {
          validAnswerIds.push(answerId);
        } else {
          invalidAnswerIds.push(answerId);
        }
      }

      if (validAnswerIds.length === 0) {
        return `❌ None of the provided answer IDs are valid for question #${questionId}.`;
      }

      await this.db.markAnswersAsSolution(questionId, validAnswerIds);

      let response = `✅ Question #${questionId} marked as solved!\n\n`;

      if (validAnswerIds.length === 1) {
        response += `✔️  Answer #${validAnswerIds[0]} marked as the solution.\n\n`;
      } else {
        response += `✔️  Answers marked as solutions: ${validAnswerIds.join(', ')}\n\n`;
      }

      if (invalidAnswerIds.length > 0) {
        response += `⚠️  Invalid answer IDs (skipped): ${invalidAnswerIds.join(', ')}\n\n`;
      }

      response += `📤 Posting to Discourse forum...`;

      try {
        const discourseResult = await this.db.postQuestionToDiscourse(questionId);

        if (discourseResult.success && discourseResult.topicUrl) {
          response += `\n\n✅ Posted to forum:\n${discourseResult.topicUrl}`;
        } else {
          response += `\n\n⚠️  Discourse posting failed: ${discourseResult.error || 'Unknown error'}`;
        }
      } catch (discourseError) {
        console.error('Discourse posting error:', discourseError);
        response += `\n\n⚠️  Discourse posting failed: ${discourseError instanceof Error ? discourseError.message : 'Unknown error'}`;
      }

      return this.formatForSignal(response);
    } catch (error) {
      console.error('Error marking as solved:', error);
      return `❌ Failed to mark as solved: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private formatForSignal(text: string): string {
    return text
      .replace(/^#{1,6}\s+(.+)$/gm, (_, content) => content.toUpperCase())
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\[([^\]]+)\]\(([^)]+)\)\*/g, '$1 ($2)')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
